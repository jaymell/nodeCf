#!/usr/bin/env node

var AWS = require('aws-sdk');
const Promise = require('bluebird');
const fs = require('fs');
const yaml = require('js-yaml');
const nodeCf = require('./nodeCf.js');

if (process.argv.length <= 2) {
  console.log("Usage: " + __filename + " <environment name> [ -r <region> ] [ -p <profile>] ");
  process.exit(-1);
}

async function main() {
  var argv = require('minimist')(process.argv.slice(2));
  var env = argv['_'][0];
  var region = argv['r'] || 'us-east-1';
  var profile = argv['p'];
  var deleteStacks = argv['delete'];

  AWS.config.setPromisesDependency(Promise);
  if (typeof profile !== 'undefined' && profile) {
    var credentials = new AWS.SharedIniFileCredentials({
      profile: profile
    });
    AWS.config.credentials = credentials;
  }

  AWS.config.update({
    region: region
  });

  const envVars = yaml.safeLoad(fs.readFileSync(`./config/${env}.yml`));
  const globalVars = yaml.safeLoad(fs.readFileSync(`./config/global.yml`));
  const stackVars = yaml.safeLoad(fs.readFileSync(`./config/stacks.yml`));

  try {
    const cfStacks = nodeCf(AWS, env, region, envVars, globalVars, stackVars);
    if (deleteStacks === true) {
      await cfStacks.delete();
    }
    else {
      await cfStacks.deploy();      
    } 
  } catch (e) {
    console.log(`Deployment Failed: ${e.message}`)
    process.exit(1)
  }

}

main()