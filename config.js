const _ = require('lodash');
const yaml = require('js-yaml'); 
const nunjucks = require("nunjucks");
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
  const globalCfg = cfg.globalCfg || `${localCfgDir}/global.yml`;
  const stackCfg = cfg.stackCfg || `${localCfgDir}/stacks.yml`;
  const s3CfTemplateDir = cfg.s3CfTemplateDir || `/${args.env}/templates`;
  const s3LambdaDir = cfg.s3LambdaDir || `/${args.env}/lambda`;

  return {
    localCfTemplateDir: localCfTemplateDir,
    localCfgDir: localCfgDir,
    globalCfg: globalCfg,
    stackCfg: stackCfg,
    s3CfTemplateDir: s3CfTemplateDir,
    s3LambdaDir: s3LambdaDir
  }
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

  var getStackNames = stacks => ( _.isString(stacks) ? 
                                  _.map(stacks.split(','), stack => stack.trim()) 
                                  : undefined )

  return {
    environment: argv['_'][0],
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
function renderConfig(myVars, templateVars) {
  if (typeof templateVars === 'undefined') {
    // use variables as inputs
    // for their own rendering
    templateVars = JSON.parse(JSON.stringify(myVars));
  }
  var myVars = JSON.parse(nunjucks.renderString(JSON.stringify(myVars), templateVars));
  _.forOwn(myVars, function(v, k) {
    if (typeof v === "string" && v.includes('{{') && v.includes('}}'))
      myVars = renderConfig(myVars, templateVars);
  });
  return myVars;
}

// render and validate config
function loadEnvConfig(envVars, schema) {
  envVars = renderConfig(envVars);
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
  parseArgs: parseArgs,
  filterStacks: filterStacks,
  renderConfig: renderConfig,
  loadEnvConfig: loadEnvConfig,
  loadNodeCfConfig: loadNodeCfConfig,
  isValidJsonSchema: isValidJsonSchema,
}