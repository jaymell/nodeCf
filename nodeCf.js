var Promise = require('bluebird');
var nunjucks = require("nunjucks");
var yaml = require('js-yaml');
var _ = require('lodash');
var Ajv = require('ajv');

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
    name: `${spec.environment}-${spec.application}-${spec.name}`,
    environment: spec.environment,
    application: spec.application,
    deps: spec.deps,
    parameters: _.flattenDeep(_.map(spec.parameters, function(i) {
                        return _.map(i, (v, k) => ({ ParameterKey: k, ParameterValue: v }));
                    })),
    tags: _.flattenDeep(_.map(spec.tags, function(i) {
                return _.map(i, (v, k) => ({ Key: k, Value: v }));
              })),
    // templateURL: spec.templateURL,
    // deploy() {
    //   return ensureBucket(cli, infraBucket)
    //            .then(() => ensureAwsCfStack(cli, {
    //              StackName: this.name,
    //              Parameters: this.parameters,
    //              Tags: this.tags,
    //              TemplateURL: this.templateURL,
    //            }))
    //            .then(() => console.log(`deployed ${this.name}!`));
    // } 
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

function uploadTemplate() {

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
function createAwsCfStack(cli, cfStack) {
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
    v.application = envConfig.application;
    v.environment = envConfig.environment;
    v.account = envConfig.account;
  });
  return myVars;
}

function deploy(params) {
  var stacks = params.stacks;
  var cli = params.cli;
  var infraBucket = params.infraBucket;
  return ensureBucket(cli, infraBucket)
         .then(() => Promise.each(stacks, () => ensureAwsCfStack( ))






          ensureAwsCfStack(cli, {
           StackName: this.name,
           Parameters: this.parameters,
           Tags: this.tags,
           TemplateURL: this.templateURL,
         }))
         .then(() => console.log(`deployed ${this.name}!`));
  } 
}

// FIXME: `env` is a bit sloppy, prevents needing to explicitly define
// environment in config file, which is sort of redundant:
module.exports = function(cli, env, envVars, globalVars, stackVars) {
  envConfig = loadEnvConfig(env, globalVars, envVars, envConfigSchema);
  stackConfig = loadStackConfig(stackVars, envConfig, cfStackConfigSchema);
  
  console.log('env: ', envConfig)
  console.log('stacks: ', stackConfig)
  stacks = _.map(stackConfig.stacks, v => cfStack(v))
  deploy({ 
    stacks: stackConfig.stacks, 
    cli: cli, 
    infraBucket: infraBucket,
  })
  return stacks;
};
