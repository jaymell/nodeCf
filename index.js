#!/usr/bin/env node

const Promise = require('bluebird');
const fs = require('fs');
const yaml = require('js-yaml');
const _ = require('lodash');
const config = require('./config.js');
const templater = require('./templater.js');
const path = require('path');
const schema = require('./schema.js');
const nodeCf = require('./nodeCf.js');
const utils = require('./utils.js');

const DEFAULT_REGION = 'us-east-1';

function usage() {
  // FIXME: add more description here
  const usageStr = `\n\tUsage: node_modules/.bin/nodeCf <ENVIRONMENT> ` +
                   `[ ACTION ] ` +
                   ` -s,--stacks <STACK NAMES> ` +
                   ` [ -r <REGION> ] [ -p <PROFILE> ] ` +
                   `[-e, --extraVars <VARIABLES>] ` +
                   `\n\n\tVARIABLES should be "Key=Value" pairs;
                   several can be passed if separated by space\n`;
  console.log(usageStr);
  process.exit(-1);
}

async function main() {

  var args, nodeCfCfg, nj, globalVars, envVars;

  try {
    args = config.parseArgs(
      require('minimist')(process.argv.slice(2),
        {default: { region: DEFAULT_REGION }})
    );
  } catch (e) {
    console.log(`Failed to parse command line arguments: ${e.message}`);
    usage();
  }

  try {
    if ( typeof args.cfg !== 'undefined') {
      try {
        var cfg = yaml.safeLoad(fs.readFileSync(args.cfg));
      } catch (e) {
        console.log(`Unable to load nodeCf config file: ${e.message}`);
        process.exit(1);
      }
    } else {
      var cfg = {};
    }
    nodeCfCfg = config.loadNodeCfConfig(args.environment, cfg);
  }
  catch (e) {
    console.log(e.message);
    usage();
  }

  // instantiate nunjucks renderer
  try {
    // imported relative to current directory:
    try {
      const filtersModule = await utils.fileExists(path.join(process.cwd(),
        nodeCfCfg.filters));
      const filters = require(filtersModule);
      nj = templater.loadNjEnv(filters.sync || filters, filters.async);
    } catch (e) {
      nj = templater.loadNjEnv();
    }
  } catch (e) {
    console.log('Failed to load Nunjucks environment: ', e);
    process.exit(1);
  }

  // FIXME: global should probably just be optional
  try {
    globalVars = yaml.safeLoad(
      fs.readFileSync(
        nodeCfCfg.globalCfg
    ));
  } catch (e) {
    console.log(`Failed to load global config: ${e.message}`);
    process.exit(1);
  }

  try {
    envVars = yaml.safeLoad(
      fs.readFileSync(
        path.join(
          nodeCfCfg.localCfgDir,
         `${args.environment}.yml`
    )));

  } catch (e) {
    console.log(`Failed to load environment config: ${e.message}`);
    process.exit(1);
  }

  try {
    // concatenate variables, with env-specific overriding global,
    // then render and validate:
    envVars = await config.loadEnvConfig(nj, _.assign(globalVars,
        envVars,
        { environment: args.environment, region: args.region },
        args.extraVars),
      schema.envConfigSchema);
  } catch (e) {
    console.log('Invalid environment configuration: ', e);
    process.exit(1);
  }

  try {

    // stacks passed on cli can override stacks defined on env file
    let stackFilters = args.stackFilters || envVars.stacks;

    stackVars = config.filterStacks(
      yaml.safeLoad(
        fs.readFileSync(
          nodeCfCfg.stackCfg)
      ),
      stackFilters
    );

    // if no stacks exist or no stacks match filter:
    if (stackVars.length == 0) {
      throw new Error('invalid stack argument');
    }

    // add default tags:
    _.forEach(stackVars, stack => {
      stack.tags = _.assign(nodeCfCfg.defaultTags, stack.tags);
    });

    // validate stackVars:
    _.forEach(stackVars, (v, k) => {
      if (!config.isValidJsonSchema(schema.cfStackConfigSchema, v))
        throw new Error('Stack config file is invalid!');
    });
  } catch (e) {
    console.log(`Failed to load stack config: `, e);
    process.exit(1);
  }

  try {
    // FIXME: this is stupid but currently
    // necessary to assist with testing
    nodeCf.configAws({
      profile: args.profile,
      region: envVars.region
    });
  } catch (e) {
    console.log('Failed to set AWS config: ', e);
    process.exit(1);
  }

  var stacks;
  try {
    stacks = _.map(stackVars, v => new nodeCf.CfStack(v, nodeCfCfg));
  } catch (e) {
    console.log(`Failed to instantiate stack objects: ${e.message}`);
    process.exit(1);
  }

  switch (args.action) {
    case 'deploy':
      try {
        await nodeCf.deploy(nj, stacks, envVars);
      } catch (e) {
        console.log(`deployment failed: `, e);
        process.exit(1);
      }
      break;
    case 'validate':
      try {
        await nodeCf.validate(nj, stacks, envVars);
      } catch (e) {
        console.log(`validation failed: `, e);
        process.exit(1);
      }
      break;
    case 'delete':
      try {
        await nodeCf.deleteStacks(stacks, envVars);
      } catch (e) {
        console.log(`delete failed: `, e);
        process.exit(1);
      }
      break;
    default:
      usage();
  }
}

main();

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
  process.exit(1);
});
