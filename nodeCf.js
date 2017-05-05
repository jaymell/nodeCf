var Promise = require('bluebird');
var nunjucks = require("nunjucks");
var _ = require('lodash');
var Ajv = require('ajv');
var fs = require('fs');

// schema to validate stacks
// defined in config files
var cfStackConfigSchema = {
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

var envConfigSchema = {
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

function wrap(items, keyName, valueName) {
  return _(items)
    .toPairs()
    .map(([k, v]) => [[keyName, k], [valueName, v]])
    .map(_.fromPairs)
    .value()
}

class CfStack {
  constructor(spec) {
    _.merge(this, spec)
    this.parameters = wrap(spec.parameters, "ParameterKey", "ParameterValue"),
    this.tags = wrap(spec.tags, "Key", "Value"),
    this.deployName = `${spec.environment}-${spec.application}-${spec.name}`;
  }
}

// return promise that resolves to true/false or rejects with error
function bucketExists(cli, bucket) {
  return cli.headBucket({
      Bucket: bucket
    }).promise()
    .then(() => Promise.resolve(true))
    .catch((e) => {
      switch (e.statusCode) {
        case 403:
          return Promise.reject(new Error('403: You don\'t have permissions to access this bucket'));
        case 404:
          return Promise.resolve(false);
        default:
          throw e;
      }
    });
}

function createBucket(cli, bucket) {
  return cli.createBucket({
    Bucket: bucket
  }).promise();
}

function ensureBucket(cli, bucket) {
  return bucketExists(cli, bucket)
    .then(d => d ? Promise.resolve() : createBucket(cli, bucket));
}

function s3Upload(cli, bucket, src, dest) {
  console.log(`uploading template ${src} to s3://${bucket}/${dest}`);
  var stream = fs.createReadStream(src);
  return cli.upload({
    Bucket: bucket,
    Key: dest,
    Body: stream
  }).promise();
}

function awsCfStackExists(cli, stackName) {
  return cli.describeStacks({
      StackName: stackName
    })
    .promise()
    .then(() => Promise.resolve(true))
    .catch((e) => {
      if (e.message.includes('does not exist')) {
        return Promise.resolve(false);
      } else {
        throw e;
      }
    });
}

function createAwsCfStack(cli, params) {
  console.log(`creating cloudformation stack ${params.StackName}`);
  return cli.createStack(params).promise()
    .then(data =>
      cli.waitFor('stackCreateComplete', {
        StackName: data.stackId
      }).promise())
    .catch(e => console.log('Error creating stack: ', e));
}

function ensureAwsCfStack(cli, params) {
  return awsCfStackExists(cli, params.StackName)
    .then(r => (r ? updateAwsCfStack(cli, params) : createAwsCfStack(cli, params)));
}

function updateAwsCfStack(cli, params) {
  console.log(`updating cloudformation stack ${params.StackName}`);
  return cli.updateStack(params).promise()
    .then(data =>
      cli.waitFor('stackUpdateComplete', {
        StackName: data.stackId
      }).promise())
    .catch(function(e) {
      switch (e.message) {
        case 'No updates are to be performed.':
          return Promise.resolve("No updates are to be performed");
        default:
          throw e;
      }
    });
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

  var envConfig = loadEnvConfig(env, region, globalVars, envVars, envConfigSchema);
  var stackConfig = loadStackConfig(stackVars, envConfig, cfStackConfigSchema);
  // TODO: add validator for nodeCfConfig:
  var nodeCfConfig = nodeCfConfig || defaultNodeCfConfig(envConfig.application,
    envConfig.environment);
  var stacks = _.map(stackConfig.stacks, v => new CfStack(v));

  return {
    envConfig: envConfig,
    stackConfig: stackConfig,
    nodeCfConfig: nodeCfConfig,
    stacks: stacks,

    deploy() {
      var s3Cli = new AWS.S3();
      var cfCli = new AWS.CloudFormation();
      var infraBucket = envConfig.infraBucket;
      var srcDir = nodeCfConfig.localCfTemplateDir;
      var destDir = nodeCfConfig.s3CfTemplateDir;
      return ensureBucket(s3Cli, infraBucket)
        .then(() => Promise.each(stacks, function(stack) {
          var src = `${srcDir}/${stack.name}.yml`;
          var timestamp = new Date().getTime();
          var dest = `${destDir}/${stack.name}-${timestamp}.yml`;
          return s3Upload(s3Cli, infraBucket, src, dest)
            .then(data => ensureAwsCfStack(cfCli, {
              StackName: stack.deployName,
              Parameters: stack.parameters,
              Tags: stack.tags,
              TemplateURL: data.Location
            }))
            .then(() => console.log(`deployed ${stack.deployName}!`));
        }));
    }
  };
};
