#!/usr/bin/env node

var AWS = require('aws-sdk');
const Promise = require('bluebird');
const fs = require('fs');
const yaml = require('js-yaml'); 
const nodeCf = require('./nodeCf.js');
const _ = require('lodash');
const config = require('./config.js');
const path = require('path');
const schema = require('./schema.js');

function usage() {
  const usageStr = `\n\tUsage: node_modules/.bin/nodeCf <ENVIRONMENT> [ ACTION ] [ -r <REGION> ] [ -p <PROFILE> ] [ -s,--stacks <STACK NAMES> ]`
  console.log(usageStr);
  process.exit(-1);
}

async function main() {

  var args, nodeCfCfg, globalVars, envVars, stacks;

  try {
    args = config.parseArgs(require('minimist')(process.argv.slice(2), {default: {region: 'us-east-1'}})
    );
  } catch (e) {
    console.log(e.message);
    usage();
  }

  try {
    nodeCfCfg = loadNodeCfConfig(args);
  }
  catch (e) {
    console.log(e.message);
    usage();
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
         `${config.env}.yml`
    )));

  } catch (e) {
    console.log(`Failed to load environment config: ${e.message}`);
    process.exit(1);
  }


  try {
    // concatenate variables, with env-specific overriding global,
    // then render and validate:
    envVars = loadEnvConfig(_.assign(globalVars, 
      envVars, 
      { environment: args.env,
        region: args.region
    }), schema.envConfigSchema);
  } catch (e) {

  }

  try {
    // only run stacks that were passed on command line
    // (if none passed, all will be run):
    stacks = config.filterStacks(
      yaml.safeLoad(
        fs.readFileSync(
          nodeCfCfg.stackCfg)
      ),
      args.stackFilters
    );  
  } catch (e) {
    console.log(`Failed to load stack config: ${e.message}`);
    process.exit(1);  
  }

  // if no stacks exist or no stacks match filter:
  if (stacks.length == 0) {
    console.log('invalid stack argument');
    process.exit(1);
  }

  const deployment = nodeCf(args.region, args.profile);

  switch (args.action) {
    case 'deploy':
      try {
        await cfStacks.deploy();
      } catch (e) {
        console.log(`deployment failed: ${e.message}`)
        process.exit(1)
      }
      break;
    case 'validate':
      try {
        await cfStacks.validate();
      } catch (e) {
        console.log(`validation failed: ${e.message}`)
        process.exit(1)
      }
      break;
    case 'delete':
      try {
        await cfStacks.delete();
      } catch (e) {
        console.log(`delete failed: ${e.message}`)
        process.exit(1)
      }
      break;
    default:
      usage();
  }
}

main()
