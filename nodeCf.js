const Promise = require('bluebird');
const _ = require('lodash');
const fs = Promise.promisifyAll(require('fs'));
const path = require("path");
const config = require('./config.js');
const schema = require('./schema.js');
const util = require('./util.js');
const templater = require('./templater.js');
const child_process = Promise.promisifyAll(require('child_process'));
const AWS = require('aws-sdk');;
AWS.config.setPromisesDependency(Promise);

var wrapWith = (wk, wv, obj) => 
  _.toPairs(obj).map((it) => 
    _.zipObject([wk, wv], it));

class CfStack {
  constructor(stackVars, nodeCfConfig) {
    // _.merge(this, spec)
    this.name = stackVars.name;
    this.rawStackVars = stackVars;
    this.nodeCfConfig = nodeCfConfig;
    this.schema = schema.cfStackConfigSchema;
  }

  // // this happens just prior to deployment, so that any
  // // variables needed by previously deployed stacks
  // // can be used
  // async load(nj, envVars, stackOutputs) {
  //   this.parameters = wrapWith("ParameterKey", "ParameterValue", 
  //     this.stackVars.parameters);
  //   this.tags = wrapWith("Key", "Value", this.stackVars.tags);
  //   this.preTasks = this.stackVars.preTasks;
  //   this.postTasks = this.stackVars.postTasks;
  //   this.deployName = `${envVars.environment}-${envVars.application}-${this.name}`;
  // }

  async uploadTemplate() {
    await ensureBucket(this.infraBucket);
    const timestamp = new Date().getTime();
    this.s3Location = path.join(this.nodeCfConfig.s3CfTemplateDir,
      `${this.name}-${timestamp}.yml`);
    return await s3Upload(this.infraBucket, this.template, this.s3Location);
  }


  async execTasks(tasks, taskType) {
    if ( typeof tasks !== 'undefined' ){
      if (taskType) console.log(`running ${taskType}... `)
      const output = await Promise.each(tasks, async(task) => 
        child_process.execAsync(task));
    }
  }

  async validate(nj, envVars) {
    this.template = await getTemplateFile(this.nodeCfConfig.localCfTemplateDir, 
      this.rawStackVars.name);
    this.infraBucket = envVars.infraBucket;
    await ensureBucket(this.infraBucket);
    const s3Resp = await this.uploadTemplate()
    await validateAwsCfStack({
      TemplateURL: s3Resp.Location,
    });
    console.log(`${this.name} is a valid Cloudformation template`);
  }

  async deploy(nj, envVars, stackOutputs) {
    this.deployName = `${envVars.environment}-${envVars.application}-${this.name}`;
    console.log(`deploying ${this.deployName}`);
    this.template = await getTemplateFile(this.nodeCfConfig.localCfTemplateDir,
      this.name);
    this.infraBucket = envVars.infraBucket;

    // render stack dependencies
    this.stackDependencies = await Promise.map(
      _.without(this.rawStackVars.stackDependencies, _.isUndefined),
      async(it) => { 
        const stuff = await templater.render(nj, it, _.assign(envVars, stackOutputs));
        return stuff; });

    // run stack dependencies and add them to outputs
    const depResp = _.chain(await Promise.map(this.stackDependencies,
      async(it) => await awsDescribeCfStack(it)))
      .forEach(it => { 
        it.outputs = unwrapOutputs(it.Outputs); 
        it.stackAbbrev = _.last(_.split(it.StackName, '-'))
      })
      .map(it => _.pick(it, ['stackAbbrev', 'outputs']))
      .keyBy('stackAbbrev')
      .value()

    stackOutputs.stacks = _.chain(stackOutputs.stacks)
      .cloneDeep()
      .assign(depResp).value()

    // render and run stack creation stacks
    if (!(await awsCfStackExists(this.deployName))) {
      this.creationTasks = await templater.render(nj, 
        this.rawStackVars.creationTasks, 
        _.assign(envVars, stackOutputs));
      await this.execTasks(this.creationTasks, 'creation tasks');
    }

    // render pre-tasks
    this.preTasks = await Promise.map(_.without(this.rawStackVars.preTasks, _.isUndefined), 
      async(it) => templater.render(nj, it, _.assign(envVars, stackOutputs)));

    // run pre-tasks 
    await this.execTasks(this.preTasks, 'pre-tasks');

    // render and wrap parameters and tags
    this.parameters = wrapWith("ParameterKey", "ParameterValue", await templater.render(nj, 
      this.rawStackVars.parameters, 
      _.assign(envVars, stackOutputs)));
    this.tags = wrapWith("Key", "Value", await templater.render(nj, 
      this.rawStackVars.tags, 
      _.assign(envVars, stackOutputs)));

    // deploy stack 
    await ensureBucket(this.infraBucket);
    const s3Resp = await this.uploadTemplate()
    const stackResp = await ensureAwsCfStack({
      StackName: this.deployName,
      Parameters: this.parameters,
      Tags: this.tags,
      TemplateURL: s3Resp.Location,
      Capabilities: [ 'CAPABILITY_IAM', 
        'CAPABILITY_NAMED_IAM' ]
    });
    
    // update stack outputs
    this.outputs = unwrapOutputs(stackResp.Outputs);
    stackOutputs.stacks[this.name] = {};
    stackOutputs.stacks[this.name]['outputs'] = this.outputs;

    // render post-tasks
    this.postTasks = await Promise.map(_.without(this.rawStackVars.postTasks, _.isUndefined), 
      async(it) => templater.render(nj, it, _.assign(envVars, stackOutputs)));

    // run post-tasks
    await this.execTasks(this.postTasks, 'post-tasks');

    console.log(`deployed ${this.deployName}`);

  }

  async delete() {
    await deleteAwsCfStack({
      StackName: this.deployName
    });
    console.log(`deleted ${this.deployName}`);
  }
}

function unwrapOutputs(outputs) {
  return _.chain(outputs)
    .keyBy('OutputKey')
    .mapValues('OutputValue')
    .value();
}

// look for template having multiple possible file extensions
async function getTemplateFile(templateDir, stackName) {
  const f = await Promise.any(_.map(['yml', 'json', 'yaml'], async(ext) => 
    await util.fileExists(`${path.join(templateDir, stackName)}.${ext}`)
    ));
  if (f) return f;
  else throw new Error(`Stack template "${stackName}" not found!`); 
}

// return promise that resolves to true/false or rejects with error
async function bucketExists(bucket) {
  const cli = new AWS.S3();
  try {
    await cli.headBucket({
      Bucket: bucket
    }).promise();
    return true;
  } catch (e) {
    switch (e.statusCode) {
      case 403:
        throw new Error('403: You don\'t have permissions to access this bucket');
      case 404:
        return false;
      default:
        throw e;
    }
  }
}

function createBucket(bucket) {
  const cli = new AWS.S3();
  return cli.createBucket({
    Bucket: bucket
  }).promise();
}

async function ensureBucket(bucket) {
  if (!await bucketExists(bucket)) {
    await createBucket(bucket)
  }
}

function s3Upload(bucket, src, dest) {
  const cli = new AWS.S3();
  console.log(`uploading template ${src} to s3://${path.join(bucket, dest)}`);
  const stream = fs.createReadStream(src);
  return cli.upload({
    Bucket: bucket,
    Key: dest,
    Body: stream
  }).promise();
}

async function awsCfStackExists(stackName) {
  const cli = new AWS.CloudFormation();
  try {
    await cli.describeStacks({
      StackName: stackName
    }).promise();
    return true;
  } catch (e) {
    if (e.message.includes('does not exist')) {
      return false;
    } else {
      throw e;
    }
  }
}

async function createAwsCfStack(params) {
  const cli = new AWS.CloudFormation();
  console.log(`creating cloudformation stack ${params.StackName}`);
  try {
    const data = await cli.createStack(params).promise()
    await cli.waitFor('stackCreateComplete', {
      StackName: params.StackName
    }).promise()
  }
  catch (e) {
    switch (e.message) {
      case 'Resource is not in the state stackCreateComplete':
        throw new Error('stack creation failed');
      default:
        throw e;
    }
  }
}

async function updateAwsCfStack(params) {
  const cli = new AWS.CloudFormation();
  console.log(`updating cloudformation stack ${params.StackName}`);
  try {
    const data = await cli.updateStack(params).promise()
    await cli.waitFor('stackUpdateComplete', {
      StackName: params.StackName
    }).promise()
  } catch (e) {
    switch (e.message) {
      case 'No updates are to be performed.':
        return "stack is up-to-date";
      case 'Resource is not in the state stackUpdateComplete':
        throw new Error('stack update failed');
      default:
        throw e;
    }
  }
}

async function awsDescribeCfStack(stackName) {
  const cli = new AWS.CloudFormation();
  const outputs = await cli.describeStacks({
    StackName: stackName
  }).promise()
  return outputs.Stacks[0];
}

// update / create and return its info:
async function ensureAwsCfStack(params) {
  const cli = new AWS.CloudFormation();
  if (await awsCfStackExists(params.StackName)) {
    await updateAwsCfStack(params)
  } else {
    await createAwsCfStack(params)
  }
  const output = await awsDescribeCfStack(params.StackName);
  return output;
}

async function deleteAwsCfStack(params) {
  const cli = new AWS.CloudFormation();
  console.log(`deleting cloudformation stack ${params.StackName}`);
  try {
    const data = await cli.deleteStack(params).promise();
    await cli.waitFor('stackDeleteComplete', {
      StackName: params.StackName
    }).promise();
  } catch (e) {
    throw e;
  }
}

async function validateAwsCfStack(params) {
  const cli = new AWS.CloudFormation();
  try {
    const data = await cli.validateTemplate(params).promise();
  } catch (e) {
    throw e;
  }
}

function configAws(params) {
  if (typeof params.profile !== 'undefined' && params.profile) {
    var credentials = new AWS.SharedIniFileCredentials({
      profile: params.profile
    });
    AWS.config.credentials = credentials;
  }

  AWS.config.update({
    region: params.region
  });
}

async function validate(nj, stacks, envVars) {
  await Promise.each(stacks, async(stack) => {
    await stack.validate(nj, envVars);
  });
}

async function deploy(nj, stacks, envVars) {
  var stackOutputs = { stacks: {} };
  await Promise.each(stacks, async(stack) => {
    stackOutputs.stacks[stack.name] = {};
    const deployed = await stack.deploy(nj, envVars, stackOutputs);
    stackOutputs.stacks[stack.name]['outputs'] = stack.outputs;
  });
}

async function deleteStacks(stacks) {
  // reverse array prior to deletion:
  await Promise.each(stacks.reverse(), async(stack) => {
    await stack.delete();
  });
}

module.exports = {
    configAws: configAws,
    CfStack: CfStack,
    validate: validate,
    delete: deleteStacks,
    deploy: deploy,
    getTemplateFile: getTemplateFile,
    wrapWith: wrapWith
};
