const _ = require('lodash');
const yaml = require('js-yaml'); 
const nunjucks = require("nunjucks");
const Ajv = require('ajv');


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

function loadNodeCfConfig(args) {

  var cfg;

  if ( typeof args.cfg !== 'undefined') {
    try {
      cfg = yaml.safeLoad(fs.readFileSync(args.cfg));
    } catch (e) {
      console.log(`Unable to load nodeCf config file: ${e.message}`)
      process.exit(1);
    }
  } else {
    cfg = {};
  }

  const localCfTemplateDir = cfg.localCfTemplateDir || `./templates`;
  const localCfgDir =  cfg.localCfgDir || `./config`;
  const globalCfg = cfg.globalCfg || `${localConfigDir}/global.yml`;
  const stackCfg = cfg.stackCfg || `${localConfigDir}/stacks.yml`;
  const s3CfTemplateDir = cfg.s3CfTemplateDir || `/${args.env}/templates`;
  const s3LambdaDir = cfg.s3LambdaDir || `/${args.env}/lambda`;
  const defaultRegion = cfg.defaultRegion || 'us-east-1';

  return {
    localCfTemplateDir: localCfTemplateDir,
    localCfgDir: localCfgDir,
    globalConfig: globalConfig,
    s3CfTemplateDir: s3CfTemplateDir,
    s3LambdaDir: s3LambdaDir,
    defaultRegion: defaultRegion
  }
}

// at a minimum, environment name must be passed via CLI:
function parseArgs(argv) {
  if (process.argv.length <= 2)
    throw new Error('invalid arguments passed');
  if ( argv['_'].length < 1 ) 
    throw new Error('invalid arguments passed');
  
  // default action
  var action = 'deploy';
  if ( argv['_'].length >= 2 ) {
    action = argv['_'][1];
  }

  // fail out if empty '-s' or '--stacks' passed:
  if ('s' in argv || 'stacks' in argv) {
    let stacks = argv['s'] || argv['stacks'];
    if (typeof stacks !== 'string') {
      console.log('No stack name passed');
      process.exit(1);      
    }
  } 

  var getStackNames = stacks => ( _.isString(stacks) ? 
                                  _.map(stacks.split(','), stack => stack.trim()) 
                                  : undefined )

  return {
    env: argv['_'][0],
    action: action,
    region: argv['r'],
    profile: argv['p'],
    cfg: argv['c'] || argv['config'],
    stackFilters: getStackNames(argv['s'] || argv['stacks']) || undefined
  }
}

function filterStacks(stacks, stackFilters) {
  if ( stackFilters instanceof Array === false || stackFilters.length === 0) {
    return stacks.stacks;
  }

  // throw if an invalid stack name was passed:
  const stackNames = _.map(stacks.stacks, stack => stack.name)
  const diff = _.difference(stackFilters, stackNames)
  if ( diff.length !== 0 ) {
    throw(`Invalid stack name(s) passed: ${diff}`);
  }

  return _.filter(stacks.stacks, stack => stackFilters.includes(stack.name))
}

// allows for referencing other variables within the config;
// recurse until there aren't any more values to be de-templatized:
function renderConfig(myVars, templateVars) {
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
  _.forEach(myVars, function(v, k) {
    if (!isValidJsonSchema(schema, v)) throw new Error('Stack does not match schema!');
    v.application = envVars.application;
    v.environment = envVars.environment;
    v.account = envVars.account;
  });
  return myVars;
}


module.exports = {
  parseArgs: parseArgs,
  filterStacks: filterStacks,
  renderConfig: renderConfig,
  loadEnvConfig: loadEnvConfig,
  loadStackConfig: loadStackConfig,
  isValidJsonSchema: isValidJsonSchema,
}