#!/usr/bin/env node

const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const yaml = require('js-yaml');
const _ = require('lodash');
const config = require('./src/config.js');
const templater = require('./src/templater.js');
const path = require('path');
const schema = require('./src/schema.js');
const nodeCf = require('./src/nodeCf.js');
const utils = require('./src/utils.js');
const debug = require('debug')('index');

function usage() {
  /* eslint-disable */
  const usageStr = `\n\tUsage: ` +
					`\n\t\tnode_modules/.bin/nodeCf -e,--environment <ENVIRONMENT> -r,--region <REGION> [ -s,--stacks <STACK NAMES> ] [ -p <PROFILE> ] [-x, --extraVars <VARIABLES>] [ ACTION ]` +
                   `\n\n\tACTION defaults to 'deploy'; other options are 'validate' and 'delete'` +
                   `\n\n\tVARIABLES should be "Key=Value" pairs; several can be passed if separated by spaces and wrapped in quotes, e.g., "Key1=Value1 Key2=Value2"\n`;
  /* eslint-enable */
  console.log(usageStr);
  process.exit(-1);
}

async function main() {

  var args, nodeCfCfg, nj, globalVars, envVars;

  try {
    args = config.parseArgs(
      require('minimist')(process.argv.slice(2))
    );
  } catch (e) {
    console.log(`Failed to parse command line arguments: ${e.message}`);
    usage();
  }

  try {
    if (typeof args.cfg !== 'undefined') {
      try {
        const cfg = yaml.safeLoad(await fs.ReadFileAsync(args.cfg));
      } catch (e) {
        console.log(`Unable to load nodeCf config file: ${e.message}`);
        process.exit(1);
      }
    } else {
      var cfg = {};
    }
    nodeCfCfg = config.loadNodeCfConfig(args.environment, cfg);
    debug('nodeCfCfg: ', nodeCfCfg);
  }
  catch (e) {
    console.log(e.message);
    usage();
  }

  // instantiate nunjucks, include filters
  // if they exist:
  const filtersModule = path.join(process.cwd(),
        nodeCfCfg.filters);
  if (fs.existsSync(filtersModule)) {
    try {
      const filters = require(filtersModule);
      nj = templater.loadNjEnv(filters.sync, filters.async);
    } catch (e) {
      console.log('Failed to load Nunjucks environment: ', e);
      process.exit(1);
    }
  }
  else {
    try {
      nj = templater.loadNjEnv();
    } catch (e) {
      console.log('Failed to load Nunjucks environment: ', e);
      process.exit(1);
    }
  }

  // load global config if it exists:
  if (fs.existsSync(nodeCfCfg.globalCfg)) {
    try {
      globalVars = yaml.safeLoad(
        await fs.readFileAsync(
          nodeCfCfg.globalCfg
      ));
    } catch (e) {
      console.log(`Failed to load global config: ${e.message}`);
      process.exit(1);
    }
  }

  try {
    envVars = yaml.safeLoad(
      await fs.readFileAsync(
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
    envVars = await config.loadEnvConfig(nj, _.merge(globalVars,
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
        await fs.readFileAsync(
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
    // this is done b/c aws-sdk-mock
    // expects AWS to be imported in same
    // module that it's used -- else would
    // probably make more sense to declare it in
    // this module:
    nodeCf.configAws({
      profile: args.profile,
      region: envVars.region
    });
  } catch (e) {
    console.log('Failed to set AWS config: ', e);
    process.exit(1);
  }

  switch (args.action) {
    case 'deploy':
      try {
        await nodeCf.deploy(stackVars, envVars, nj, nodeCfCfg);
      } catch (e) {
        console.log(`deployment failed: `, e);
        process.exit(1);
      }
      break;
    case 'validate':
      try {
        await nodeCf.validate(stackVars, envVars, nj, nodeCfCfg);
      } catch (e) {
        console.log(`validation failed: `, e);
        process.exit(1);
      }
      break;
    case 'delete':
      try {
        // note that stack order is reversed prior to deletion:
        await nodeCf.deleteStacks(stackVars.reverse(), envVars, nj, nodeCfCfg);
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
