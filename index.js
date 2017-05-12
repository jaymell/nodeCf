#!/usr/bin/env node

var AWS = require('aws-sdk');
const Promise = require('bluebird');
const fs = require('fs');
const yaml = require('js-yaml'); 
const nodeCf = require('./nodeCf.js');
const _ = require('lodash');

function usage() {
  const usageStr = `Usage: " + __filename + " <environment name> <action (deploy, delete, or validate)> [ -r <region> ] [ -p <profile> ] [ -s,--stacks <stack name>]`
  console.log(usageStr);
  process.exit(-1);
}

function parseArgs(argv) {
  if (process.argv.length <= 2) usage();
  if ( argv['_'].length < 1 ) usage();
  
  // default action
  var action = 'deploy';
  if ( argv['_'].length >= 2 ) {
    action = argv['_'][1];
  }

  var getStacks = stacks => ( _.isString(stacks) ? _.map(stacks.split(','), stack => stack.trim()) : undefined )

  return {
    env: argv['_'][0],
    action: action,
    region: argv['r'] || 'us-east-1',
    profile: argv['p'],
    stacks: getStacks(argv['s'] || argv['stacks'])
  }
}

async function main() {

  const config = parseArgs(require('minimist')(process.argv.slice(2)));
  const envVars = yaml.safeLoad(fs.readFileSync(`./config/${config.env}.yml`));
  const globalVars = yaml.safeLoad(fs.readFileSync(`./config/global.yml`));
  const stackVars = yaml.safeLoad(fs.readFileSync(`./config/stacks.yml`));

  const cfStacks = nodeCf({
    env: config.env, 
    region: config.region,
    profile: config.profile,
    envVars: envVars,
    globalVars: globalVars,
    stackVars: stackVars
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