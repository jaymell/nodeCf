const Promise = require('bluebird');
const _ = require('lodash');
const Ajv = require('ajv');
const templater = require('./templater.js');
const debug = require('debug')('config');
const yaml = require('js-yaml');
const fs = Promise.promisifyAll(require('fs'));
const schema = require('./schema.js');
const utils = require('./utils.js');
const path = require("path");


// load yaml, replace
// null values with name of key;
// f should be open file or string
function loadYaml(f) {
  return replaceNullValues(yaml.load(f));
}

function replaceNullValues(obj, type = 'Object') {
  var method;
  if (type === 'Object') {
    method = _.mapValues;
  }
  else if (type === 'Array') {
    method = _.map;
  }
  return method(obj, (v, k) => {
    if (_.isPlainObject(v)) {
      return replaceNullValues(v, 'Object');
    }
    if (_.isArray(v)) {
      return replaceNullValues(v, 'Array');
    }
    if (v === null) {
      return `{{${k}}}`;
    }
    return v;
  });
}

async function loadStackYaml(stackCfg, stackFilters) {
  return filterStacks(
    loadYaml(
      await fs.readFileAsync(
        stackCfg)
    ),
    stackFilters
  );
}

async function loadStacks(stackCfg, stackFilters, schema, stackDefaults) {
  const stacks = await loadStackYaml(stackCfg, stackFilters);

  // if no stacks exist or no stacks match filter:
  if (stacks.length == 0) {
    throw new Error('invalid stack argument');
  }

  return _.chain(stacks)
    // assign default stack params
    .map(stack => _.assign({}, stackDefaults, stack))
    // validate stack vars
    .map((stack) => {
      if (!isValidJsonSchema(schema, stack)) {
        throw new Error('Stack config file is invalid!');
      }
      return stack;
    }).value();
}

async function loadStackGroups(stackCfg, stackGroups, schema, stackDefaults) {
  const stacks = await loadStacks(stackCfg, [], schema, stackDefaults);

  validateStackGroups(stackGroups, stacks);

  return _.map(
    stackGroups,
    (stackGroup) => ({
      name: stackGroup.name,
      stacks: _.map(stackGroup.stacks, (stackName) => _.find(stacks, (x) => x.name == stackName)),
    })
  );
}

function loadNodeCfConfig(cfg) {

  if ( typeof cfg === 'undefined') cfg = {};

  const localCfgDir = cfg.localCfgDir || `./config`;

  const defaults = {
    localCfTemplateDir: `./templates`,
    localCfgDir: localCfgDir,
    filters: `${localCfgDir}/filters.js`,
    s3CfTemplateDir: `nodeCf/templates`,
    s3LambdaDir: `nodeCf/lambda`,
    globalCfg: `${localCfgDir}/global.yml`,
    stackCfg: `${localCfgDir}/stacks.yml`,
    deleteUploadedTemplates: true,
    stackDefaults: {
      capabilities: [ 'CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM' ],
      timeout: 45,
      tags: {
        // these are rendered at deployment time:
        environment: "{{environment}}",
        application: "{{application}}"
      },
    }
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

function parseStringArrays(arr) {
  if(!_.isString(arr)) {
    throw new Error(`${arr} is not a string`);
  }
  return _.map(arr.replace(/\s+/g,' ').trim().split(' '), it => it);
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
  if ('s' in argv || 'stacks' in argv) failIfEmpty('s', 'stacks', argv);
  return {
    environment: argv['e'] || argv['environment'],
    extraVars: parseExtraVars(argv['x'] || argv['extraVars']),
    action: action,
    region: argv['r'] || argv['region'],
    profile: argv['p'],
    cfg: argv['c'] || argv['config'],
    stackFilters: argv['s'] || argv['stacks'] || undefined
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
    throw new Error(`Invalid stack name(s) passed: ${diff}`);
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

// if file exists, load it, else return undefined.
// Iterate through various possible file extensions
// in attempt to find file.
async function loadConfigFile(filePath) {
  const f = await Promise.any(
    _.map(['.yml', '.yaml', '.json', ''], async(ext) =>
      await utils.fileExists(`${filePath}${ext}`)));
  if (f) {
    return loadYaml(await fs.readFileAsync(f));
  }
  return undefined;
}

function isValidJsonSchema(schema, spec) {
  var ajv = new Ajv.default({
    allErrors: true
  });
  var valid = ajv.compile(schema);
  if (!(valid(spec))) {
    console.error(ajv.errorsText());
    return false;
  }
  return true;
}

function validateStackGroups(stackGroups, stacks) {
  if (_.isUndefined(stackGroups)) {
    return [];
  }

  if(!isValidJsonSchema(schema.stackGroupsSchema, stackGroups)) {
    throw new Error('stack groups schema failed validation');
  }

  const duplicateGroupNames = _.chain(stackGroups)
    .groupBy('name')
    .pickBy((v, k) => v.length > 1)
    .keys()
    .value();
  if(duplicateGroupNames.length > 0) {
    throw new Error(`the following stackGroup(s) can only be defined once: ${duplicateGroupNames.join(', ')}`);
  }

  const stacksToGroups = _.flatMap(stackGroups, (x) => _.map(x.stacks, (y) => [y, x.name]));

  const undefinedStackNames = _.chain(stacksToGroups)
    .map((x) => x[0])
    .uniqBy()
    .filter((x) => !_.find(stacks, ({name}) => name == x))
    .value();
  if(undefinedStackNames.length > 0) {
    throw new Error(`the following stack(s) need to be defined in the stacks file: ${undefinedStackNames.join(', ')}`);
  }

  const duplicateStackNames = _.chain(stacksToGroups)
    .groupBy((x) => x[0])
    .pickBy((v, k) => v.length > 1)
    .keys()
    .value();
  if(duplicateStackNames.length > 0) {
    throw new Error(`the following stack(s) cannot appear in more than one group: ${duplicateStackNames.join(', ')}`);
  }
}

module.exports = {
  parseExtraVars: parseExtraVars,
  parseArgs: parseArgs,
  filterStacks: filterStacks,
  loadEnvConfig: loadEnvConfig,
  loadConfigFile: loadConfigFile,
  loadNodeCfConfig: loadNodeCfConfig,
  isValidJsonSchema: isValidJsonSchema,
  loadStacks: loadStacks,
  loadStackGroups: loadStackGroups,
  loadYaml: loadYaml,
  parseStringArrays: parseStringArrays,
  validateStackGroups: validateStackGroups,
};
