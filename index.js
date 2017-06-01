#!/usr/bin/env node

const Promise = require('bluebird');
const fs = require('fs');
const yaml = require('js-yaml'); 
const _ = require('lodash');
const config = require('./config.js');
const path = require('path');
const schema = require('./schema.js');
const nodeCf = require('./nodeCf.js');
const util = require('./util.js');

function usage() {
  // FIXME: add more description here
  const usageStr = `\n\tUsage: node_modules/.bin/nodeCf <ENVIRONMENT> ` +
                   `[ ACTION ] [ -r <REGION> ] [ -p <PROFILE> ] ` +
                   `[-e, --extraVars <VARIABLES>] ` +
                   `[ -s,--stacks <STACK NAMES> ] ` +
                   `\n\n\tVARIABLES should be "Key=Value" pairs; several can be passed if separated by space\n`
  console.log(usageStr);
  process.exit(-1);
}

async function main() {

  var args, nodeCfCfg, nj, globalVars, envVars;

  try {
    args = config.parseArgs(
      require('minimist')(process.argv.slice(2), {default: {region: 'us-east-1'}})
    );
  } catch (e) {
    console.log(`Failed to parse command line arguments: ${e.message}`);
    usage();
  }

  try {
    nodeCfCfg = config.loadNodeCfConfig(args);
  }
  catch (e) {
    console.log(e.message);
    usage();
  }

  // instantiate nunjucks renderer
  try {
    // imported relative to current directory:
    try {
      const filtersModule = await util.fileExists(path.join(process.cwd(), nodeCfCfg.filters));
      const filters = require(filtersModule);
      nj = config.loadNjEnv(filters.sync || filters);
      nj = config.loadNjAsync(nj, filters.async);
    } catch (e) {

      nj = config.loadNjEnv();
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
    // only run stacks that were passed on command line
    // (if none passed, all will be run):
    stackVars = config.filterStacks(
      yaml.safeLoad(
        fs.readFileSync(
          nodeCfCfg.stackCfg)
      ),
      args.stackFilters
    );
    // if no stacks exist or no stacks match filter:
    if (stackVars.length == 0) {
      throw new Error('invalid stack argument');
    }
    // add default tags:
    _.forEach(stackVars, stack => {
      stack.tags = _.assign(nodeCfCfg.defaultTags, stack.tags)
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
    // FIXME: this is stupid
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
    stacks = _.map(stackVars, v => 
      new nodeCf.CfStack(v, nodeCfCfg));
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
        await nodeCf.delete(stacks);
      } catch (e) {
        console.log(`delete failed: `, e);
        process.exit(1);
      }
      break;
    default:
      usage();
  }
}

main()

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
  process.exit(1);
});
