#!/usr/bin/env node

var AWS = require('aws-sdk');
const Promise = require('bluebird');
const fs = require('fs');
const yaml = require('js-yaml'); 
const nodeCf = require('./nodeCf.js');
const _ = require('lodash');
const cli = require('./cli.js');

const DEFAULT_REGION = 'us-east-1';

function usage() {
  const usageStr = `\n\tUsage: node_modules/.bin/nodeCf <ENVIRONMENT> [ ACTION ] [ -r <REGION> ] [ -p <PROFILE> ] [ -s,--stacks <STACK NAMES> ]
`
  console.log(usageStr);
  process.exit(-1);
}

async function main() {

  try {
    var config = cli.parseArgs(require('minimist')(process.argv.slice(2)));
  }
  catch (e) {
    console.log(e.message);
    usage();
  }

  try {
    var envVars = yaml.safeLoad(fs.readFileSync(`./config/${config.env}.yml`));
    var globalVars = yaml.safeLoad(fs.readFileSync(`./config/global.yml`));
    var stacks = cli.filterStacks(yaml.safeLoad(fs.readFileSync(`./config/stacks.yml`)),
                                config.stackFilters);
  } catch (e) {
    console.log(e);
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
