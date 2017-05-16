const _ = require('lodash');

// contains helper functions for index.s

function parseArgs(argv) {
  if (process.argv.length <= 2) usage();
  if ( argv['_'].length < 1 ) usage();
  
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