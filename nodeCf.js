var Promise = require('bluebird');
var nunjucks = require("nunjucks");
var yaml = require('js-yaml');
var _ = require('lodash');
var Ajv = require('ajv');

// schema to validate stacks
// defined in config files
var cfStackSchema = {
  properties: {
    name: { 
      type: "string",
      pattern: "^[a-zA-Z0-9\-]+$"
     },
    application: { type: "string" },
    account: { type: "string" },
    environment: { type: "string" },
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
    templateBody: { type: "string" },
    templateUrl: { type: "string" },
    deps: { type: "array", items: { type: "string" } }
  },
  required: ["name", "account", "environment", "application"]
};

// primary object for stack objects
function cfStack(spec) {
  var ajv = new Ajv({ useDefaults: true });
  var validate = ajv.compile(cfStackSchema);
  if (!validate(spec)) {
    throw new Error('Stack does not match schema!')
  }
  var that = {};
  that.deployName = function() { 
    return `${spec.environment}-${spec.application}-${spec.name}`; 
  }();
  that.name = spec.name;
  that.environment = spec.environment;
  that.application = spec.application;

  // convert to api format
  that.parameters = _.flattenDeep(_.map(spec.parameters, function(i) {
                        return _.map(i, (v, k) => ({ ParameterKey: k, ParameterValue: v }));
                    }));

  // convert to api format
  that.tags = _.flattenDeep(_.map(spec.tags, function(i) {
                return _.map(i, (v, k) => ({ Key: k, Value: v }));
              })); 

  that.dependencies = spec.dependencies;
  return that;
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

function cfStackExists(cli, stack) {
  return cli.describeStacks({StackName: stack}).promise()
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

function createCfStack(cli, params) {
  return cli.CreateStack(params).Promise()
}

function updateCfStackNewTemplate(cli, stack) {

}

function updateCfStackUseExisting(cli, params) {

}

// allows for referencing other variables within the config;
// recurse until there aren't any more values to be de-templatized:
function parseConfig(myVars) {
  myVars = JSON.parse(nunjucks.renderString(JSON.stringify(myVars), myVars ));
  _.forOwn(myVars, function(v, k) {
    if ( typeof v == "string" && v.includes('{{') && v.includes('}}'))
      myVars = parseConfig(myVars);
  });
  return myVars;
}

// pass var objects; variables will be
// env-specific will overwrite any conflicting
// global vars 
function loadConfig(globalVars, envVars) {
  var myVars = _.extend(globalVars, envVars);
  return parseConfig(myVars);
}

module.exports = {
  cfStack: cfStack,
  bucketExists: bucketExists,
  createBucket: createBucket,
  ensureBucket: ensureBucket,
  cfStackExists: cfStackExists,
  createCfStack: createCfStack,
  updateCfStackNewTemplate: updateCfStackNewTemplate,
  updateCfStackUseExisting: updateCfStackUseExisting,
  loadConfig: loadConfig
};
