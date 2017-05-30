const Promise = require('bluebird');
const _ = require('lodash');
const yaml = require('js-yaml'); 
const nunjucks = Promise.promisifyAll(require("nunjucks"));
const Ajv = require('ajv');

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
  const filters = cfg.filters || `${localCfgDir}/filters.js`;
  const s3CfTemplateDir = cfg.s3CfTemplateDir || `/${args.environment}/templates`;
  const s3LambdaDir = cfg.s3LambdaDir || `/${args.environment}/lambda`;
  const globalCfg = cfg.globalCfg || `${localCfgDir}/global.yml`;
  const stackCfg = cfg.stackCfg || `${localCfgDir}/stacks.yml`;
  const defaultTags = cfg.defaultTags || { environment: args.environment, application: "{{application}}" };

  return {
    localCfTemplateDir: localCfTemplateDir,
    localCfgDir: localCfgDir,
    filters: filters,
    globalCfg: globalCfg,
    stackCfg: stackCfg,
    s3CfTemplateDir: s3CfTemplateDir,
    s3LambdaDir: s3LambdaDir,
    defaultTags: defaultTags
  }
}

// filters should be object literal 
// containing functions
function loadNjEnv(filters) {
  const env = new nunjucks.Environment();
  if ( typeof filters !== 'undefined') {
    _.forEach(filters, it => {
      env.addFilter(it.name, it)});
  }
  return env;
}

// add async filters to nunjucks environment;
// filters should be object literal containing
// functions:
function loadNjAsync(env, filters) {
  if ( typeof filters !== 'undefined') {
    _.forEach(filters, it => {
      env.addFilter(it.name, it, true)});
  }
  return env;
}

// given a string of one or more key-value pairs
// separated by '=', convert and return object
function parseExtraVars(extraVars) {
  if (!(_.isString(extraVars))) {
    return undefined
  }
  const myVars = _.split(extraVars, ' ').map(it => {
    const v = _.split(it, '=')
    if ( v.length != 2 ) 
      throw new Error("Can't parse variable");
    return v
  });
  return _.fromPairs(myVars)
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
// recurse until there aren't any more values to be rendered:
async function renderConfig(nj, myVars, templateVars) {
  if (typeof templateVars === 'undefined') {
    // use variables as inputs
    // for their own rendering
    templateVars = JSON.parse(JSON.stringify(myVars));
  }
  var myVars = await nj.renderStringAsync(JSON.stringify(myVars), templateVars);
  myVars = JSON.parse(myVars);
  _.forOwn(myVars, async function(v, k) {
    if (typeof v === "string" && v.includes('{{') && v.includes('}}'))
      myVars = await renderConfig(nj, myVars, templateVars);
  });
  return myVars;
}

// render and validate config
async function loadEnvConfig(nj, envVars, schema) {
  envVars = await renderConfig(nj, envVars);
  if (!(isValidJsonSchema(schema, envVars))) {
    throw new Error('Environment config failed schema validation');
  }
  return envVars;
}

// render and validate config
async function loadStackConfig(nj, stackVars, envVars, schema) {
  stackVars = await renderConfig(nj, stackVars, envVars);
  if (!(isValidJsonSchema(schema, stackVars))) {
    throw new Error('Stack config failed schema validation');
  }
  return stackVars;
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
  loadNjEnv: loadNjEnv,
  loadNjAsync: loadNjAsync,
  loadStackConfig: loadStackConfig,
  isValidJsonSchema: isValidJsonSchema,
  renderConfig: renderConfig
}
