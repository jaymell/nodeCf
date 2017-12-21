const Promise = require('bluebird');
const _ = require('lodash');
const yaml = require('js-yaml');
const Ajv = require('ajv');
const templater = require('./templater.js');
const debug = require('debug')('config');

function loadNodeCfConfig(environment, cfg) {

  if ( typeof cfg === 'undefined') cfg = {};

  const localCfgDir = cfg.localCfgDir || `./config`;

  const defaults = {
    localCfTemplateDir: `./templates`,
    localCfgDir: localCfgDir,
    filters: `${localCfgDir}/filters.js`,
    s3CfTemplateDir: `${environment}/templates`,
    s3LambdaDir: `${environment}/lambda`,
    globalCfg: `${localCfgDir}/global.yml`,
    stackCfg: `${localCfgDir}/stacks.yml`,
    defaultTags: {
      environment: environment,
      application: "{{application}}"
    },
    timeout: 45,
    capabilities: [ 'CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM' ]
  };


  return _.merge(defaults, cfg);
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

function failIfAbsent(shortFlag, longFlag, argv) {
  // fail out if not passed:
  if ((!(shortFlag in argv)) && (!(longFlag in argv))) {
    throw new Error(`No ${longFlag} passed`);
  }
}

function failIfEmpty(shortFlag, longFlag, argv) {
  // fail if empty passed:
  let env = argv[shortFlag] || argv[longFlag];
  if (typeof env !== 'string') {
    throw new Error(`No ${longFlag} passed`);
  }
}

// validate command line arguments
function parseArgs(argv) {
  debug('parseArgs argv: ', argv);

  // default action
  var action = 'deploy';
  if ( argv['_'].length >= 1 ) {
    action = argv['_'][0];
  }

  failIfEmpty('e', 'environment', argv);
  failIfAbsent('e', 'environment', argv);
  failIfEmpty('r', 'region', argv);
  failIfAbsent('r', 'region', argv);
  if ('s' in argv || 'stacks' in argv) failIfEmpty('s', 'stacks', argv);

  var getStackNames = stacks =>
    ( _.isString(stacks) ?
      _.map(stacks.split(','), stack => stack.trim())
      : undefined );

  return {
    environment: argv['e'] || argv['environment'],
    extraVars: parseExtraVars(argv['x'] || argv['extraVars']),
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
// with subsequent vars overriding
// prior vars:
async function loadEnvConfig(nj, schema, ...vars) {
  const assignedVars = _.assign({}, ...vars);
  debug('loadEnvConfig: vars before render: ', assignedVars);
  const envVars = await templater.renderObj(nj, assignedVars);
  debug('loadEnvConfig: vars after render: ', envVars);
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
