#!/usr/bin/env node

var AWS = require('aws-sdk');
const Promise = require('bluebird');
const fs = require('fs');
const yaml = require('js-yaml'); 
const nodeCf = require('./nodeCf.js');
const _ = require('lodash');
const cli = require('./cli.js');
const path = require('path');

function usage() {
  const usageStr = `\n\tUsage: node_modules/.bin/nodeCf <ENVIRONMENT> [ ACTION ] [ -r <REGION> ] [ -p <PROFILE> ] [ -s,--stacks <STACK NAMES> ]`
  console.log(usageStr);
  process.exit(-1);
}

async function main() {

  var args, nodeCfCfg 

  try {
    args = cli.parseArgs(require('minimist')(process.argv.slice(2)));
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
    var globalVars = yaml.safeLoad(
      fs.readFileSync(
        nodeCfCfg.globalCfg
    ));  
  } catch (e) {
    console.log(`Failed to load global config: ${e.message}`);
    process.exit(1);  
  }

  try {
    var envVars = yaml.safeLoad(
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
    // only run stacks that were passed on command line
    // (if none passed, all will be run):
    var stacks = cli.filterStacks(
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

  if (stacks.length == 0) {
    console.log('invalid stack argument');
    process.exit(1);
  }

  const cfStacks = nodeCf({
    env: config.env, 
    region: config.region || DEFAULT_REGION,
    profile: config.profile,
    envVars: envVars,
    globalVars: globalVars,
    stackVars: stacks
  });

  switch (config.action) {
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
