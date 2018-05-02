const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const yaml = require('js-yaml');
const _ = require('lodash');
const config = require('./config.js');
const templater = require('./templater.js');
const path = require('path');
const schema = require('./schema.js');
const nodeCf = require('./nodeCf.js');
const utils = require('./utils.js');
const debug = require('debug')('index');
const AWS = require('aws-sdk');
AWS.config.setPromisesDependency(Promise);

// for mocking:
var loadStacks = config.loadStacks;

function usage() {
  /* eslint-disable */
  const usageStr = `\n\tUsage: ` +
          `\n\t\tnode_modules/.bin/nodeCf -e,--environment <ENVIRONMENT> [ -r,--region <REGION> ] [ -s,--stacks <STACK NAMES> ] [ -p <PROFILE> ] [-x, --extraVars <VARIABLES>] [ ACTION ]` +
                   `\n\n\tACTION defaults to 'deploy'; other options are 'validate' and 'delete'` +
                   `\n\n\tVARIABLES should be "Key=Value" pairs; several can be passed if separated by spaces and wrapped in quotes, e.g., "Key1=Value1 Key2=Value2"\n`;
  /* eslint-enable */
  console.log(usageStr);
  process.exit(-1);
}

// instantiate nunjucks, include filters
// if they exist:
function loadNunjucks(filtersModule) {
  if (fs.existsSync(filtersModule)) {
    try {
      const filters = require(filtersModule);
      nj = templater.loadNjEnv(filters.sync, filters.async);
    } catch (e) {
      console.log('Failed to load Nunjucks environment: ', e);
      process.exit(1);
    }
  }
  else {
    try {
      nj = templater.loadNjEnv();
    } catch (e) {
      console.log('Failed to load Nunjucks environment: ', e);
      process.exit(1);
    }
  }
}

function configAws(params) {
  if (typeof params.profile !== 'undefined' && params.profile) {
    const credentials = new AWS.SharedIniFileCredentials({
      profile: params.profile
    });
    AWS.config.credentials = credentials;
  }
  AWS.config.update({
    region: params.region
  });
}

async function loadEnvironment(argv) {

  var args, cfg, nodeCfCfg, nj, globalVars, envFileVars, stacks;

  try {
    args = config.parseArgs(
      require('minimist')(argv)
    );
  } catch (e) {
    console.log(`Failed to parse command line arguments: ${e.message}`);
    usage();
  }

  try {
    let _cfg;
    if (typeof args.cfg !== 'undefined') {
      try {
        _cfg = yaml.safeLoad(await fs.ReadFileAsync(args.cfg));
      } catch (e) {
        console.log(`Unable to load nodeCf config file: ${e.message}`);
        process.exit(1);
      }
    } else {
      _cfg = {};
    }
    nodeCfCfg = config.loadNodeCfConfig(_cfg);
    debug('nodeCfCfg: ', nodeCfCfg);
  }
  catch (e) {
    console.log("Failed to load nodecf config: ", e.message);
    usage();
  }

  // instantiate nunjucks, include filters
  // if they exist:
  const filtersModule = path.join(process.cwd(), nodeCfCfg.filters);
  if (fs.existsSync(filtersModule)) {
    try {
      const filters = require(filtersModule);
      nj = templater.loadNjEnv(filters.sync, filters.async);
    } catch (e) {
      console.log('Failed to load Nunjucks environment: ', e);
      process.exit(1);
    }
  }
  else {
    try {
      nj = templater.loadNjEnv();
    } catch (e) {
      console.log('Failed to load Nunjucks environment: ', e);
      process.exit(1);
    }
  }

  try {
    globalVars = await config.loadEnvFile(nodeCfCfg.localCfgDir, "global");
  } catch (e) {
    console.log("Failed to load global config file. Continuing without it.");
    debug(e.message);
  }

  try {
    envFileVars = await config.loadEnvFile(nodeCfCfg.localCfgDir, args.environment);
  } catch (e) {
    console.log("Failed to load environment config file. Continuing without it");
    debug(e.message);
  }

  try {
    // concatenate variables,
    // cli-passed vars override
    // environment variables override
    // environment config file variables override
    // global config file variables:
    envVars = await config.loadEnvConfig(nj,
      schema.envConfigSchema,
      globalVars,
      envFileVars,
      { environment: args.environment, region: args.region },
      process.env,
      args.extraVars);
  } catch (e) {
    console.log('Invalid environment configuration: ', e);
    process.exit(1);
  }

  try {
    // stacks passed in cli can override stacks defined in env file
    let rawStackFilters = args.stackFilters || envVars.stacks;
    let stackFilters =
      ( _.isString(rawStackFilters) ?
        config.parseStringArrays(rawStackFilters) :
        rawStackFilters);
    stacks = await loadStacks(nodeCfCfg.stackCfg,
      stackFilters,
      schema.cfStackConfigSchema,
      nodeCfCfg.stackDefaults);
  } catch (e) {
    console.log(`Failed to load stack config: `, e);
    process.exit(1);
  }

  configAws({ profile: args.profile, region: envVars.region });

  return { action: args.action, stacks: stacks, envVars: envVars, nj: nj, nodeCfCfg: nodeCfCfg };
}

async function run(action, stacks, envVars, nj, nodeCfCfg) {

  switch (action) {
    case 'deploy':
      try {
        await nodeCf.deploy(stacks, envVars, nj, nodeCfCfg);
      } catch (e) {
        console.log(`deployment failed: `, e);
        process.exit(1);
      }
      break;
    case 'validate':
      try {
        await nodeCf.validate(stacks, envVars, nj, nodeCfCfg);
      } catch (e) {
        console.log(`validation failed: `, e);
        process.exit(1);
      }
      break;
    case 'delete':
      try {
        // note that stack order is reversed prior to deletion:
        await nodeCf.deleteStacks(stacks.reverse(), envVars, nj, nodeCfCfg);
      } catch (e) {
        console.log(`delete failed: `, e);
        process.exit(1);
      }
      break;
    default:
      usage();
  }
}

module.exports = {
    loadEnvironment: loadEnvironment,
    run: run
};
