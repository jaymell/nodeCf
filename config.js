const Promise = require('bluebird');
const _ = require('lodash');
const yaml = require('js-yaml');
const Ajv = require('ajv');
const templater = require('./templater.js');
const debug = require('debug')('config');

function loadNodeCfConfig(args) {

  var cfg;

  if ( typeof args.cfg !== 'undefined') {
    try {
      cfg = yaml.safeLoad(fs.readFileSync(args.cfg));
    } catch (e) {
      console.log(`Unable to load nodeCf config file: ${e.message}`);
      process.exit(1);
    }
  } else {
    cfg = {};
  }

  const localCfTemplateDir = cfg.localCfTemplateDir || `./templates`;
  const localCfgDir =  cfg.localCfgDir || `./config`;
  const filters = cfg.filters || `${localCfgDir}/filters.js`;
  const s3CfTemplateDir = cfg.s3CfTemplateDir ||
    `/${args.environment}/templates`;
  const s3LambdaDir = cfg.s3LambdaDir || `/${args.environment}/lambda`;
  const globalCfg = cfg.globalCfg || `${localCfgDir}/global.yml`;
  const stackCfg = cfg.stackCfg || `${localCfgDir}/stacks.yml`;
  const defaultTags = cfg.defaultTags ||
    { environment: args.environment, application: "{{application}}" };

  return {
    localCfTemplateDir: localCfTemplateDir,
    localCfgDir: localCfgDir,
    filters: filters,
    globalCfg: globalCfg,
    stackCfg: stackCfg,
    s3CfTemplateDir: s3CfTemplateDir,
    s3LambdaDir: s3LambdaDir,
    defaultTags: defaultTags
  };
}


// given a string of one or more key-value pairs
// separated by '=', convert and return object
function parseExtraVars(extraVars) {
  if (!(_.isString(extraVars))) {
    return undefined;
  }
  const myVars = _.split(extraVars, ' ').map(it => {
    const v = _.split(it, '=');
    if ( v.length != 2 )
      throw new Error("Can't parse variable");
    return v;
  });
  return _.fromPairs(myVars);
}

// validate command line arguments
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
      throw new Error('No stack name passed');
    }
  }

  var getStackNames = stacks =>
    ( _.isString(stacks) ?
      _.map(stacks.split(','), stack => stack.trim())
      : undefined );

  return {
    environment: argv['_'][0],
    extraVars: parseExtraVars(argv['e'] || argv['extraVars']),
    action: action,
    region: argv['r'] || argv['region'],
    profile: argv['p'],
    cfg: argv['c'] || argv['config'],
    stackFilters: getStackNames(argv['s'] || argv['stacks']) || undefined
  };
}

function filterStacks(stacks, stackFilters) {
  if ( stackFilters instanceof Array === false || stackFilters.length === 0) {
    return stacks.stacks;
  }

  // throw if an invalid stack name was passed:
  const stackNames = _.map(stacks.stacks, stack => stack.name);
  const diff = _.difference(stackFilters, stackNames);
  if ( diff.length !== 0 ) {
    throw(`Invalid stack name(s) passed: ${diff}`);
  }

  return _.filter(stacks.stacks, stack => stackFilters.includes(stack.name));
}

// render and validate config
async function loadEnvConfig(nj, envVars, schema) {
  debug('loadEnvConfig: envVars before render: ', envVars);
  envVars = await templater.renderObj(nj, envVars);
  debug('loadEnvConfig: envVars after render: ', envVars);
  if (!(isValidJsonSchema(schema, envVars))) {
    throw new Error('Environment config failed schema validation');
  }
  return envVars;
}

function isValidJsonSchema(schema, spec) {
  var ajv = new Ajv({
    useDefaults: true
  });
  var valid = ajv.compile(schema);
  if (!(valid(spec))) return false;
  return true;
}

module.exports = {
  parseExtraVars: parseExtraVars,
  parseArgs: parseArgs,
  filterStacks: filterStacks,
  loadEnvConfig: loadEnvConfig,
  loadNodeCfConfig: loadNodeCfConfig,
  isValidJsonSchema: isValidJsonSchema
};
