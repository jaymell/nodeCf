#!/usr/bin/env node

const Promise = require('bluebird');
const fs = require('fs');
const yaml = require('js-yaml'); 
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

  var args, nodeCfCfg, globalVars, envVars;

  try {
    args = config.parseArgs(
      require('minimist')(process.argv.slice(2), {default: {region: 'us-east-1'}})
    );
  } catch (e) {
    console.log(e.message);
    usage();
  }

  try {
    nodeCfCfg = config.loadNodeCfConfig(args);
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
         `${args.environment}.yml`
    )));

  } catch (e) {
    console.log(`Failed to load environment config: ${e.message}`);
    process.exit(1);
  }


  try {
    // concatenate variables, with env-specific overriding global,
    // then render and validate:
    envVars = config.loadEnvConfig(_.assign(globalVars, 
      envVars, 
      { environment: args.environment,
        region: args.region
    }), schema.envConfigSchema);
  } catch (e) {
    console.log(`Invalid environment configuration: ${e.message}`);
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
    // validate stackVars:
    _.forEach(stackVars, function(v, k) {
      if (!config.isValidJsonSchema(schema.cfStackConfigSchema, v)) 
        throw new Error('Stack config file is invalid!');
    });
  } catch (e) {
    console.log(`Failed to load stack config: `, e);
    process.exit(1);  
  }

  var nodeCf;
  try {
    nodeCf = require('./nodeCf.js')(envVars.region, args.profile);
  } catch (e) {
    console.log(`Failed to load nodeCf module: ${e.message}`);
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
        await nodeCf.deploy(stacks);
      } catch (e) {
        console.log(`deployment failed: ${e.message}`)
        process.exit(1)
      }
      break;
    case 'validate':
      try {
        await deployment.validate(stacks);
      } catch (e) {
        console.log(`validation failed: ${e.message}`)
        process.exit(1)
      }
      break;
    case 'delete':
      try {
        await deployment.delete(stacks);
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
