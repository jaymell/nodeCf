const _ = require('lodash');
const yaml = require('js-yaml'); 

// contains helper functions for index.s

function loadNodeCfConfig(args) {

  var nodeCfConfig = {};

  if ( typeof args.nodeCfConfig !== 'undefined') {
    try {
      nodeCfConfig = yaml.safeLoad(fs.readFileSync(args.nodeCfConfig));
    } catch (e) {
      console.log(`Unable to load nodeCf config file: ${e.message}`)
      process.exit(1);
    }
  }

  const localCfTemplateDir = nodeCfConfig.localCfTemplateDir || `./templates`;
  const localConfigDir =  nodeCfConfig.localConfigDir || `./config`;
  const globalConfig = nodeCfConfig.globalConfig || `${localConfigDir}/global.yml`;
  const s3CfTemplateDir = nodeCfConfig.s3CfTemplateDir || `/${args.env}/templates`;
  const s3LambdaDir = nodeCfConfig.s3LambdaDir || `/${args.env}/lambda`;

  return {
    localCfTemplateDir: localCfTemplateDir,
    localConfigDir: localConfigDir,
    globalConfig: globalConfig,
    s3CfTemplateDir: s3CfTemplateDir,
    s3LambdaDir: s3LambdaDir
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
    nodeCfConfig: argv['c'] || argv['config'],
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

module.exports = {
  parseArgs: parseArgs,
  filterStacks: filterStacks
}