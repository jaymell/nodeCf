const Promise = require('bluebird');
const nunjucks = require("nunjucks");
const _ = require('lodash');
const Ajv = require('ajv');
const fs = require('fs');

// schema to validate stacks
// defined in config files
const cfStackConfigSchema = {
  properties: {
    name: {
      type: "string",
      pattern: "^[a-zA-Z0-9\-]+$"
    },
    tags: {
      type: "array",
      items: {
        type: "object",
        patternProperties: {
          "^[a-zA-Z0-9]+$": {
            type: "string"
          }
        },
        additionalProperties: false
      },
      additionalItems: false
    },
    parameters: {
      type: "array",
      items: {
        type: "object",
        patternProperties: {
          "^[a-zA-Z0-9]+$": {
            type: "string"
          }
        },
        additionalProperties: false
      },
      additionalItems: false
    },
    deps: {
      type: "array",
      items: {
        type: "string"
      }
    }
  },
  required: ["name"]
};

const envConfigSchema = {
  properties: {
    application: {
      type: "string"
    },
    account: {
      anyOf: [{
        type: "string",
        pattern: "^[0-9]+$"
      }, {
        type: "integer"
      }]
    },
    environment: {
      type: "string"
    },
    infraBucket: {
      type: "string"
    },
    region: {
      type: "string"
    },
  },
  required: ["account", "environment", "application", "infraBucket", "region"]
};

const wrap = (wk, wv) => (obj) => _.toPairs(obj).map((it) => _.zipObject([wk, wv], it))

class CfStack {
  constructor(spec) {
    _.merge(this, spec)
    this.parameters = _.flatMap(spec.parameters, wrap("ParameterKey", "ParameterValue"))
    this.tags = _.flatMap(spec.tags, (wrap("Key", "Value")))
    this.deployName = `${spec.environment}-${spec.application}-${spec.name}`;
  }
}

// return promise that resolves to true/false or rejects with error
async function bucketExists(cli, bucket) {
  try {
    await cli.headBucket({
      Bucket: bucket
    }).promise();
    return true;
  } catch (e) {
    switch (e.statusCode) {
      case 403:
        throw new Error('403: You don\'t have permissions to access this bucket');
      case 404:
        return false;
      default:
        throw e;
    }
  }
}

function createBucket(cli, bucket) {
  return cli.createBucket({
    Bucket: bucket
  }).promise();
}

async function ensureBucket(cli, bucket) {
  if (!await bucketExists(cli, bucket)) {
    await createBucket(cli, bucket)
  }
}

function s3Upload(cli, bucket, src, dest) {
  console.log(`uploading template ${src} to s3://${bucket}/${dest}`);
  const stream = fs.createReadStream(src);
  return cli.upload({
    Bucket: bucket,
    Key: dest,
    Body: stream
  }).promise();
}

async function awsCfStackExists(cli, stackName) {
  try {
    await cli.describeStacks({
      StackName: stackName
    });
    return true;
  } catch (e) {
    if (e.message.includes('does not exist')) {
      return false;
    } else {
      throw e;
    }
  }
}

async function createAwsCfStack(cli, params) {
  console.log(`creating cloudformation stack ${params.StackName}`);

  try {
    await cli.createStack(params).promise()
    await cli.waitFor('stackCreateComplete', {
      StackName: data.stackId
    }).promise()
  } catch (e) {
    console.log('Error creating stack: ', e)
  }
}

async function ensureAwsCfStack(cli, params) {
  if (await awsCfStackExists(cli, params.StackName)) {
    await updateAwsCfStack(cli, params)
  } else {
    await createAwsCfStack(cli, params)
  }
}

async function updateAwsCfStack(cli, params) {
  console.log(`updating cloudformation stack ${params.StackName}`);

  const data = await cli.updateStack(params).promise()
  try {
    await cli.waitFor('stackUpdateComplete', {
      StackName: data.stackId
    }).promise()
  } catch (e) {
    switch (e.message) {
      case 'No updates are to be performed.':
        return "No updates are to be performed";
      default:
        throw e;
    }
  }
}

// allows for referencing other variables within the config;
// recurse until there aren't any more values to be de-templatized:
function parseConfig(myVars, templateVars) {
  var myVars = JSON.parse(nunjucks.renderString(JSON.stringify(myVars), templateVars));
  _.forOwn(myVars, function(v, k) {
    if (typeof v === "string" && v.includes('{{') && v.includes('}}'))
      myVars = parseConfig(myVars, templateVars);
  });
  return myVars;
}

// pass var objects; variables will be
// env-specific will overwrite any conflicting
// global vars
function loadEnvConfig(env, region, globalVars, envVars, schema) {
  // FIXME: `env` and `region` are handled a bit sloppy, but this
  // is current way to insert them into config, given that they are
  // supplied at runtime:
  var myVars = _.extend(globalVars, envVars, {
    environment: env,
    region: region
  });
  myVars = parseConfig(myVars, JSON.parse(JSON.stringify(myVars)));

  if (!(isValidJsonSchema(schema, myVars))) {
    throw new Error('Invalid environment configuration!');
  }
  return myVars;
}

function isValidJsonSchema(schema, spec) {
  var ajv = new Ajv({
    useDefaults: true
  });
  var valid = ajv.compile(schema);
  if (!(valid(spec))) return false;
  return true;
}

function loadStackConfig(stackVars, envVars, schema) {
  var myVars = parseConfig(stackVars, envVars);

  // validate and add config-specific properties:
  _.forEach(myVars.stacks, function(v, k) {
    v.name = k;
    if (!isValidJsonSchema(schema, v)) throw new Error('Stack does not match schema!');
    v.application = envVars.application;
    v.environment = envVars.environment;
    v.account = envVars.account;
  });
  return myVars;
}

function defaultNodeCfConfig(application, env) {
  return {
    localCfTemplateDir: `./templates`,
    s3CfTemplateDir: `${application}/${env}/templates`,
    s3LambdaDir: `${application}/${env}/lambda`
  };
};

module.exports = function(AWS, env, region, envVars, globalVars, stackVars, nodeCfConfig) {

  const envConfig = loadEnvConfig(env, region, globalVars, envVars, envConfigSchema);
  const stackConfig = loadStackConfig(stackVars, envConfig, cfStackConfigSchema);
  // TODO: add validator for nodeCfConfig:
  nodeCfConfig = nodeCfConfig || defaultNodeCfConfig(envConfig.application,
    envConfig.environment);
  const stacks = _.map(stackConfig.stacks, v => new CfStack(v));

  return {
    envConfig: envConfig,
    stackConfig: stackConfig,
    nodeCfConfig: nodeCfConfig,
    stacks: stacks,

    async deploy() {
      const s3Cli = new AWS.S3();
      const cfCli = new AWS.CloudFormation();
      const infraBucket = envConfig.infraBucket;
      const srcDir = nodeCfConfig.localCfTemplateDir;
      const destDir = nodeCfConfig.s3CfTemplateDir;
      await ensureBucket(s3Cli, infraBucket);
      await Promise.each(stacks, async(stack) => {
        const src = `${srcDir}/${stack.name}.yml`;
        const timestamp = new Date().getTime();
        const dest = `${destDir}/${stack.name}-${timestamp}.yml`;
        const data = await s3Upload(s3Cli, infraBucket, src, dest);
        await ensureAwsCfStack(cfCli, {
          StackName: stack.deployName,
          Parameters: stack.parameters,
          Tags: stack.tags,
          TemplateURL: data.Location
        });
        console.log(`deployed ${stack.deployName}!`);
      });
    }
  };
};
