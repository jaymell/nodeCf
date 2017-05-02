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
          "^[a-zA-Z0-9]+$": { type: "string" }
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
          "^[a-zA-Z0-9]+$": { type: "string" }
        },
        additionalProperties: false
      },
      additionalItems: false
    },
    deps: { type: "array", items: { type: "string" } }
  }
};

var envConfigSchema = {
  properties: {
    application: { type: "string" },
    account: { 
      anyOf: [
          {
            type: "string",
            pattern: "^[0-9]+$"             
          },
          { type: "integer"}
        ]
    },
    environment: { type: "string" },
    infraBucket: { type: "string" }
  },
  required: ["account", "environment", "application", "infraBucket"]
};

// primary object for stack objects
function cfStack(spec) {

  return {
    name: spec.name,
    deployName: `${spec.environment}-${spec.application}-${spec.name}`,
    environment: spec.environment,
    application: spec.application,
    deps: spec.deps,
    parameters: _.flattenDeep(_.map(spec.parameters, function(i) {
                        return _.map(i, (v, k) => ({ ParameterKey: k, ParameterValue: v }));
                    })),
    tags: _.flattenDeep(_.map(spec.tags, function(i) {
                return _.map(i, (v, k) => ({ Key: k, Value: v }));
              })),
    templateURL: spec.templateURL
  }
};

// return promise that resolves to true/false or rejects with error
function bucketExists(cli, bucket) {
  return cli.headBucket({Bucket: bucket}).promise()
    .then(() => Promise.resolve(true))
    .catch(function(e) {
	  	switch ( e.statusCode ) {
	  		case 403:
	  			return Promise.reject(new Error('403: You don\'t have permissions to access this bucket'));
			case 404:
	  			return Promise.resolve(false);
	  		default: 
	  			throw e;
	  	}});
}

function createBucket(cli, bucket) {
	return cli.createBucket({Bucket: bucket}).promise()
}

function ensureBucket(cli, bucket) {
	return bucketExists(cli, bucket)
           .then(d => d ? Promise.resolve() : createBucket(cli, bucket))
}

function s3Upload(cli, bucket, src, dest) {
  console.log('src: ', src);
  var stream = fs.createReadStream(src);
  return cli.upload({
      Bucket: bucket,
      Key: dest,
      Body: stream
    }).promise();
}

function awsCfStackExists(cli, stackName) {
  return cli.describeStacks({StackName: stackName}).promise()
           .then(() => Promise.resolve(true))
           .catch(function(e) {
             if (e.message.includes('does not exist')) {
               return Promise.resolve(false)
             } 
             else { 
              throw e 
             }
           })
}

// may not need -- this is probably all it will be doing:
function createAwsCfStack(cli, params) {
  return cli.createStack(params).promise()
}

function ensureAwsCfStack(cli, params) {
  return awsCfStackExists(cli, params.StackName)
           .then(r => (r ? updateAwsCfStack(cli, params) : createAwsCfStack(cli, params)))
}

function updateAwsCfStack(cli, params) {
  return cli.updateStack(params).promise()
}

// allows for referencing other variables within the config;
// recurse until there aren't any more values to be de-templatized:
function parseConfig(myVars, templateVars) {
  var myVars = JSON.parse(nunjucks.renderString(JSON.stringify(myVars), templateVars ));
  _.forOwn(myVars, function(v, k) {
    if ( typeof v === "string" && v.includes('{{') && v.includes('}}'))
      myVars = parseConfig(myVars, templateVars);
  });
  return myVars;
}

// pass var objects; variables will be
// env-specific will overwrite any conflicting
// global vars 
function loadEnvConfig(env, globalVars, envVars, schema) {
  var ajv = new Ajv({ useDefaults: true });
  var valid = ajv.compile(schema);

  var myVars = _.extend(globalVars, envVars);
  myVars = parseConfig(myVars, JSON.parse(JSON.stringify(myVars)));

  // FIXME: `env` is handled a bit sloppy, but slipping it in here prevents  
  // needing to explicitly define environment in config file, which currently
  // would be redundant: 
  myVars = _.extend(myVars, { environment: env });
  if (!(valid(myVars))) throw new Error('Invalid environment configuration!');
  return myVars;
}

function loadStackConfig(stackVars, envVars, schema) {
  var ajv = new Ajv({ useDefaults: true });
  var valid = ajv.compile(schema);
  var myVars = parseConfig(stackVars, envVars);

  // validate and add config-specific properties:
  _.forEach(myVars.stacks, function(v, k) {
    v.name = k;
    if (!valid(v)) throw new Error('Stack does not match schema!');
    v.application = envVars.application;
    v.environment = envVars.environment;
    v.account = envVars.account;
  });
  return myVars;
}

function defaultNodeCfConfig(application, env) {
  return {
    localCfTemplateDir: `./templates`,
    s3CfTemplateDir: `/${application}/${env}/templates`,
    s3LambdaDir: `/${application}/${env}/lambda`
  }
};

module.exports = function(AWS, env, envVars, globalVars, stackVars, nodeCfConfig) {

  
  var envConfig = loadEnvConfig(env, globalVars, envVars, envConfigSchema);
  var stackConfig = loadStackConfig(stackVars, envConfig, cfStackConfigSchema);
  // TODO: add validator for nodeCfConfig:
  var nodeCfConfig = nodeCfConfig || defaultNodeCfConfig(envConfig.application,
      envConfig.environment);
  var stacks = _.map(stackConfig.stacks, v => cfStack(v));

  return {
    envConfig: envConfig,
    stackConfig: stackConfig,
    nodeCfConfig: nodeCfConfig,
    stacks: stacks,
    deploy() {
      var s3Cli = new AWS.S3();
      var cfCli = new AWS.CloudFormation();
      var infraBucket = envConfig.infraBucket;
      // open file:
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
                   TemplateURL: data.Location,
                 }))
                 .then(() => console.log(`deployed ${stack.deployName}!`));
             }));
    }
  }
};

// todo:
// delete files after deployments regardless of success / failure
// use waiter to print progress of stack deployment
// better handling of environment as it's read by cloudformation params