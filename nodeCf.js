const Promise = require('bluebird');
const _ = require('lodash');
const fs = Promise.promisifyAll(require('fs'));
const path = require("path");
const config = require('./config.js');
const schema = require('./schema.js');
const util = require('./util.js');
var AWS = require('aws-sdk');;
AWS.config.setPromisesDependency(Promise);
const child_process = Promise.promisifyAll(require('child_process'));

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

  // this happens just prior to deployment, so that any
  // variables needed by previously deployed stacks
  // can be used
  async load(nj, envVars, stackOutputs) {
    this.template = await getTemplateFile(this.nodeCfConfig.localCfTemplateDir, 
      this.rawStackVars.name)
      .then(f => this.template = f);
    this.renderedStackVars = await config.loadStackConfig(nj, 
        this.rawStackVars, _.assign(envVars, stackOutputs), this.schema);
    this.infraBucket = envVars.infraBucket;
    this.parameters = wrapWith("ParameterKey", "ParameterValue", 
      this.renderedStackVars.parameters);
    this.tags = wrapWith("Key", "Value", this.renderedStackVars.tags);
    this.preTasks = this.renderedStackVars.preTasks;
    this.postTasks = this.renderedStackVars.postTasks;
    this.deployName = `${envVars.environment}-${envVars.application}-${this.name}`;
  }

  async uploadTemplate() {
    await ensureBucket(this.infraBucket);
    const timestamp = new Date().getTime();
    this.s3Location = path.join(this.nodeCfConfig.s3CfTemplateDir,
      `${this.name}-${timestamp}.yml`);
    return await s3Upload(this.infraBucket, this.template, this.s3Location);
  }

  async validate(nj, envVars) {
    await this.load(nj, envVars);
    await ensureBucket(this.infraBucket);
    const s3Resp = await this.uploadTemplate()
    await validateAwsCfStack({
      TemplateURL: s3Resp.Location,
    });
    console.log(`${this.name} is a valid Cloudformation template`);
  }

  async execTasks(tasks) {
    if ( typeof tasks !== 'undefined' ){
      const output = await Promise.each(tasks, async(task) => 
        child_process.execAsync(task));
      console.log(output);
    }
  }

  async deploy(nj, envVars, stackOutputs) {
    await this.load(nj, envVars, stackOutputs);
    await this.execTasks(this.preTasks);
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
    this.outputs = _.chain(stackResp.Outputs)
      .keyBy('OutputKey')
      .mapValues('OutputValue')
      .value();
    await this.execTasks(this.postTasks);
    console.log(`deployed ${this.deployName}`);
    return this;
  }

  async delete() {
    await deleteAwsCfStack({
      StackName: this.deployName
    });
    console.log(`deleted ${this.deployName}`);
  }
}

// look for template having multiple possible file extensions
async function getTemplateFile(templateDir, stackName) {
  const f = await Promise.any(_.map(['yml', 'json', 'yaml'], async(ext) => 
    await util.fileExists(`${path.join(templateDir, stackName)}.${ext}`)));
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

// update / create and return its info:
async function ensureAwsCfStack(params) {
  const cli = new AWS.CloudFormation();
  if (await awsCfStackExists(params.StackName)) {
    await updateAwsCfStack(params)
  } else {
    await createAwsCfStack(params)
  }
  const outputs = await cli.describeStacks({
    StackName: params.StackName
  }).promise()
  return outputs.Stacks[0];
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
    stackOutputs.stacks[stack.name]['outputs'] = deployed.outputs;
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
