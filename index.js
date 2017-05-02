#!/usr/bin/env node

var AWS = require('aws-sdk');
var Promise = require('bluebird');
var fs = require('fs');
var yaml = require('js-yaml');
var nodeCf = require('./nodeCf.js');

if (process.argv.length <= 2) {
    console.log("Usage: " + __filename + " <environment name> [ -r <region> ] [ -p <profile>] ");
    process.exit(-1);
}

var argv = require('minimist')(process.argv.slice(2));

var env = argv['_'][0];
var region = argv['r'] || 'us-east-1';
var profile = argv['p'];

AWS.config.setPromisesDependency(Promise);
if (typeof profile !== 'undefined' && profile) {
  var credentials = new AWS.SharedIniFileCredentials({profile: profile});
  AWS.config.credentials = credentials;   
}

AWS.config.update({region: region});

var envVars = yaml.safeLoad(fs.readFileSync(`./config/${env}.yml`));
var globalVars = yaml.safeLoad(fs.readFileSync(`./config/global.yml`));
var stackVars = yaml.safeLoad(fs.readFileSync(`./config/stacks.yml`));

var cfStacks = nodeCf(AWS, env, envVars, globalVars, stackVars);
console.log(JSON.stringify(cfStacks.stacks));
cfStacks.deploy();
