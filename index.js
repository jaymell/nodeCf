var AWS = require('aws-sdk');
var Promise = require('bluebird');
var fs = require('fs');
var _ = require('lodash');
var yaml = require('js-yaml');
var nodeCf = require('./nodeCf.js');

if (process.argv.length <= 2) {
    console.log("Usage: " + __filename + " <environment name> [ + region ]");
    process.exit(-1);
}
 
var env = process.argv[2];
var region = process.argv[3] || 'us-east-1';
var profile = process.argv[4] || 'personal';

AWS.config.setPromisesDependency(Promise);
var credentials = new AWS.SharedIniFileCredentials({profile: profile});
AWS.config.credentials = credentials;
AWS.config.update({region: region});

var envVars = yaml.safeLoad(fs.readFileSync(`./config/${env}.yml`));
var globalVars = yaml.safeLoad(fs.readFileSync(`./config/global.yml`));
var stackVars = yaml.safeLoad(fs.readFileSync(`./config/stacks.yml`));

cli = new AWS.CloudFormation()
stacks = nodeCf(cli, env, envVars, globalVars, stackVars);
console.log(JSON.stringify(stacks));
// s3 = 'jaymell-my-bucket'
// var obj = { name: "test", 
//             account: "test", 
//             environment: "test",
//             parameters: [{"testParam1": "test1"}, {"testParam2": "test2"}],
//             tags: [{"testTag1": "test1"}, {"testTag2": "test2"}],
//             application: "test"
//           }

// var c = nodeCf.cfStack(cli, s3, obj)