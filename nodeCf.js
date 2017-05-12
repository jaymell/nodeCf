const Promise = require('bluebird');
const nunjucks = require("nunjucks");
const _ = require('lodash');
const Ajv = require('ajv');
const fs = Promise.promisifyAll(require('fs'));
const path = require("path");
var AWS = require('aws-sdk');;
AWS.config.setPromisesDependency(Promise);

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

const wrap = _.curry((wk, wv, obj) => _.toPairs(obj).map((it) => _.zipObject([wk, wv], it)))
const wrapWith = _.curry((k, v, items) => _.flatMap(items, wrap(k, v)))

class CfStack {
  constructor(spec) {
    _.merge(this, spec)
    this.parameters = wrapWith("ParameterKey", "ParameterValue", spec.parameters)
    this.tags = wrapWith("Key", "Value", spec.tags)
    this.deployName = `${spec.environment}-${spec.application}-${spec.name}`;
  }
}

// return promise that resolves to true/false or rejects with error
async function bucketExists(bucket) {
  const cli = new AWS.S3();
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

function createBucket(bucket) {
  const cli = new AWS.S3();
  return cli.createBucket({
    Bucket: bucket
  }).promise();
}

async function ensureBucket(bucket) {
  if (!await bucketExists(bucket)) {
    await createBucket(bucket)
  }
}

function s3Upload(bucket, src, dest) {
  const cli = new AWS.S3();
  console.log(`uploading template ${src} to s3://${bucket}/${dest}`);
  const stream = fs.createReadStream(src);
  return cli.upload({
    Bucket: bucket,
    Key: dest,
    Body: stream
  }).promise();
}

async function awsCfStackExists(stackName) {
  const cli = new AWS.CloudFormation();
  try {
    await cli.describeStacks({
      StackName: stackName
    }).promise();
    return true;
  } catch (e) {
    if (e.message.includes('does not exist')) {
      return false;
    } else {
      throw e;
    }
  }
}

async function createAwsCfStack(params) {
  const cli = new AWS.CloudFormation();
  console.log(`creating cloudformation stack ${params.StackName}`);
  try {
    const data = await cli.createStack(params).promise()
    await cli.waitFor('stackCreateComplete', {
      StackName: params.StackName
    }).promise()
  }
  catch (e) {
    switch (e.message) {
      case 'Resource is not in the state stackCreateComplete':
        throw new Error('stack creation failed');
      default:
        throw e;
    }
  }
}

async function updateAwsCfStack(params) {
  const cli = new AWS.CloudFormation();
  console.log(`updating cloudformation stack ${params.StackName}`);
  try {
    const data = await cli.updateStack(params).promise()
    await cli.waitFor('stackUpdateComplete', {
      StackName: params.StackName
    }).promise()
  } catch (e) {
    switch (e.message) {
      case 'No updates are to be performed.':
        return "stack is up-to-date";
      case 'Resource is not in the state stackUpdateComplete':
        throw new Error('stack update failed');
      default:
        throw e;
    }
  }
}

async function ensureAwsCfStack(params) {
  if (await awsCfStackExists(params.StackName)) {
    await updateAwsCfStack(params)
  } else {
    await createAwsCfStack(params)
  }
}

async function deleteAwsCfStack(params) {
  const cli = new AWS.CloudFormation();
  console.log(`deleting cloudformation stack ${params.StackName}`);
  try {
    const data = await cli.deleteStack(params).promise();
    await cli.waitFor('stackDeleteComplete', {
      StackName: params.StackName
    }).promise();
  } catch (e) {
    throw e;
  }
}

async function validateAwsCfStack(params) {
  const cli = new AWS.CloudFormation();
  try {
    const data = await cli.validateTemplate(params).promise();
  } catch (e) {
    throw e;
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

// return filename if exists, else false
async function fileExists(f) {
  try {
    await fs.statAsync(f);
    return f;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return false;
  }
}

// look for template having multiple possible file extensions
async function getTemplateFile(templateDir, stackName) {
  const f = await Promise.any(_.map(['yml', 'json', 'yaml'], async(ext) => 
    await fileExists(`${path.join(templateDir, stackName)}.${ext}`)));
  if (f) return f;
  else throw new Error('Stack template not found!'); 
}

function configAws(params) {

  if (typeof params.profile !== 'undefined' && params.profile) {
    var credentials = new AWS.SharedIniFileCredentials({
      profile: params.profile
    });
    AWS.config.credentials = credentials;
  }

  AWS.config.update({
    region: params.region
  });

}

module.exports = function(params) {

  const env = params.env;
  const region = params.region;
  const profile = params.profile;
  var envVars = params.envVars;
  var globalVars = params.globalVars;
  var stackVars = params.stackVars;
  var nodeCfConfig = params.nodeCfConfig;

  configAws({
    profile: profile,
    region: region
  });

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

    async validate() {
      const infraBucket = envConfig.infraBucket;
      const srcDir = nodeCfConfig.localCfTemplateDir;
      const destDir = nodeCfConfig.s3CfTemplateDir;
      await ensureBucket(infraBucket);
      await Promise.each(stacks, async(stack) => {
        const src = await getTemplateFile(srcDir, stack.name);
        const timestamp = new Date().getTime();
        const dest = `${destDir}/${stack.name}-${timestamp}.yml`;
        const data = await s3Upload(infraBucket, src, dest);
        console.log(`validating cloudformation stack ${src}`);
        await validateAwsCfStack({
          TemplateURL: data.Location,
        });
        console.log(`${src} is a valid Cloudformation template`);
      });
    },

    async delete() {
      // reverse array prior to deletion:
      await Promise.each(stacks.reverse(), async(stack) => {
        await deleteAwsCfStack({
          StackName: stack.deployName
        });
        console.log(`deleted ${stack.deployName}`);
      })
    },

    async deploy() {
      const infraBucket = envConfig.infraBucket;
      const srcDir = nodeCfConfig.localCfTemplateDir;
      const destDir = nodeCfConfig.s3CfTemplateDir;
      await ensureBucket(infraBucket);
      await Promise.each(stacks, async(stack) => {
        const src = await getTemplateFile(srcDir, stack.name);
        const timestamp = new Date().getTime();
        const dest = `${destDir}/${stack.name}-${timestamp}.yml`;
        const data = await s3Upload(infraBucket, src, dest);
        await ensureAwsCfStack({
          StackName: stack.deployName,
          Parameters: stack.parameters,
          Tags: stack.tags,
          TemplateURL: data.Location,
          Capabilities: [ 'CAPABILITY_IAM', 
            'CAPABILITY_NAMED_IAM' ]
        });
        console.log(`deployed ${stack.deployName}`);
      });
    }
  };
};
