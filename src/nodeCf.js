const Promise = require('bluebird');
const _ = require('lodash');
const fs = Promise.promisifyAll(require('fs'));
const path = require("path");
const utils = require('./utils.js');
const schema = require('./schema.js');
const templater = require('./templater.js');
const debug = require('debug')('nodecf');
const AWS = require('aws-sdk');
AWS.config.setPromisesDependency(Promise);

class CfStack {
  constructor(stackVars, envVars, nj, nodeCfConfig) {
    this.name = stackVars.name;
    this.templateName = stackVars.templateName;
    this.role = stackVars.role;
    this.parameters = stackVars.parameters;
    this.tags = stackVars.tags;
    this.capabilities = stackVars.capabilities;
    this.timeout = stackVars.timeout;
    this.stackDependencies = stackVars.stackDependencies;
    this.lambdaArtifact = stackVars.lambdaArtifact;
    this.preTasks = stackVars.preTasks;
    this.creationTasks = stackVars.creationTasks;
    this.postTasks = stackVars.postTasks;

    this.envVars = envVars;
    this.infraBucket = envVars.infraBucket;

    this.nj = nj;
    this.nodeCfConfig = nodeCfConfig;
    this.deleteUploadedTemplates = nodeCfConfig.deleteUploadedTemplates;

    this.schema = schema.cfStackConfigSchema;

    this.deployName = stackVars.stackDeployName || `${envVars.environment}-${envVars.application}-${this.name}`;
  }

  async lateInit() {
    this.template = await getTemplateFile(this.nodeCfConfig.localCfTemplateDir,
      this.templateName || this.name);
    // if role defined at stack level, use that, otherwise
    // use one at environment level (which itself could be undefined):
    const rawRole = this.role || this.envVars.role;
    // ensure any template vars in role are processed:
    if (!(_.isUndefined(rawRole))) var role = await this.renderObj(rawRole);
    this.credentials = await this.getAwsCredentials(role);
  }

  async getAwsCredentials(role) {
    debug(`CfStack.getAwsCredentials -- role: ${role}`);
    const creds = await getAwsCredentials(role);
    return creds;
  }

  async getAwsClient(clientName) {
    const creds = this.credentials;
    // several stacks updated in rapid succession can
    // cause throttling issues, so set this to arbitrarily
    // high level:
    const maxRetries = 30;
    if(_.isUndefined(creds)) {
      return new AWS[clientName]();
    }
    return new AWS[clientName]({credentials: creds, maxRetries: maxRetries });
  }

  async uploadTemplate(cli) {
    await ensureBucket(cli, this.infraBucket);
    const timestamp = new Date().getTime();
    const s3Location = path.join(this.nodeCfConfig.s3CfTemplateDir,
      `${this.name}-${timestamp}.yml`);
    return await s3Upload(cli, this.infraBucket, this.template, s3Location);
  }

  async doLambdaArtifacts(cli, lambdaArtifact) {
    // render lambda artifact
    // and return its location:
    // FIXME: should be able to handle/return an array, not just
    // a single lambda
    if (!(_.isUndefined(lambdaArtifact))) {
      debug('CfStack.doLambdaArtifacts: running lambda tasks');
      const lambdaExports = {};
      lambdaArtifact = await this.renderObj(lambdaArtifact);
      const s3Resp = await uploadLambda(cli, this.infraBucket,
        lambdaArtifact, this.nodeCfConfig.s3LambdaDir);
      lambdaExports.bucket = this.infraBucket;
      lambdaExports.key = s3Resp.Key;
      debug(`cfStack.doLambdaArtifacts: ${JSON.stringify(lambdaExports)}`);
      return lambdaExports;
    }
  }

  async doDependencies(cli, stackDependencies) {
    // render stack dependencies
    stackDependencies = await this.renderList(stackDependencies);
    // run stack dependencies and add them to outputs
    const dependencies = _.chain(await Promise.map(stackDependencies,
      async(it) => await awsDescribeCfStack(cli, it)))
      .forEach(it => {
        it.outputs = unwrapOutputs(it.Outputs);
        // FIXME: the logic for this should go elsewhere:
        it.stackAbbrev = _.join(_.slice(_.split(it.StackName, '-'),2),'-');
      })
      .map(it => _.pick(it, ['stackAbbrev', 'outputs']))
      .keyBy('stackAbbrev')
      .value();
    return dependencies;
  }

  async renderList(vars, ...renderVars) {
    // pass in optional extra vars to be used for rendering:
    return templater.renderList(this.nj, vars,
      _.merge(this.envVars, ...renderVars));
  }

  async renderObj(vars, ...renderVars) {
    // pass in optional extra vars to be used for rendering:
    return templater.renderObj(this.nj, vars,
      _.merge(this.envVars, ...renderVars));
  }

  async doTasks(tasks, label, ...renderVars) {
    // render and run tasks
    debug(`CfStack.doTasks: calling ${label}`);
    const renderedTasks = await this.renderList(tasks, ...renderVars);
    await utils.execTasks(renderedTasks, label);
    debug(`CfStack.doTasks: returning from ${label}`);
  }

  // these only run if stack didn't already exist:
  async doCreationTasks(cli, label, tasks, ...renderVars) {
    if (!(await awsCfStackExists(cli, this.deployName))) {
      await this.doTasks(tasks, label, ...renderVars);
    }
  }

  async doStackDeploy(s3Cli, cfCli, stacks, lambdaVars) {
    // render and wrap parameters and tags
    debug(`CfStack.doStackDeploy: ${JSON.stringify(lambdaVars)}`);
    const parameters = wrapWith("ParameterKey", "ParameterValue",
      await this.renderObj(this.parameters, stacks, lambdaVars));
    const tags = wrapWith("Key", "Value",
      await this.renderObj(this.tags));
    // deploy stack
    const s3Resp = await this.uploadTemplate(s3Cli);
    const stackResp = await ensureAwsCfStack(cfCli, {
      StackName: this.deployName,
      Parameters: parameters,
      Tags: tags,
      TemplateURL: s3Resp.Location,
      Capabilities: this.capabilities,
      TimeoutInMinutes: this.timeout
    });
    if (this.deleteUploadedTemplates)
      await s3Delete(s3Cli, s3Resp.Bucket, s3Resp.Key);
    const outputs = unwrapOutputs(stackResp.Outputs);
    return outputs;
  }

  async deploy() {
  this.deployName = await this.renderObj(this.deployName);
  console.log(`deploying ${this.deployName}`);

    await this.lateInit();

    const s3Cli = await this.getAwsClient('S3');
    const cfCli = await this.getAwsClient('CloudFormation');
    const stacks = {
      stacks: await this.doDependencies(cfCli, this.stackDependencies)
    };
    // add lambda helpers to stack exports:
    const lambdaVars = {
      lambda: await this.doLambdaArtifacts(s3Cli, this.lambdaArtifact)
    };
    // creation tasks:
    await this.doCreationTasks(cfCli, 'creationTasks', this.creationTasks, stacks);
    // pre-tasks:
    await this.doTasks(this.preTasks, 'preTasks', stacks);
    // deploy stack:
    const outputs = {
      outputs: await this.doStackDeploy(s3Cli, cfCli, stacks, lambdaVars)
    };
    // post-tasks:
    await this.doTasks(this.postTasks, 'postTasks', stacks, outputs);

    console.log(`deployed ${this.deployName}`);
  }

  async delete() {
    await this.lateInit();
    this.deployName = await this.renderObj(this.deployName);
    const cfCli = await this.getAwsClient('CloudFormation');
    if (await awsCfStackExists(cfCli, this.deployName)) {
      const resp = await deleteAwsCfStack(cfCli, {
        StackName: this.deployName
      });
      debug(`CfStack.delete: ${JSON.stringify(resp)}`);
      console.log(`deleted ${this.deployName}`);
    }
    else {
      console.log('Nothing to delete.');
    }
  }

  async validate() {
    await this.lateInit();
    this.deployName = await this.renderObj(this.deployName);
    const s3Cli = await this.getAwsClient('S3');
    const cfCli = await this.getAwsClient('CloudFormation');
    const s3Resp = await this.uploadTemplate(s3Cli);
    debug('s3Resp: ', s3Resp);
    await validateAwsCfStack(cfCli, {
      TemplateURL: s3Resp.Location,
    });
    if (this.deleteUploadedTemplates)
      await s3Delete(s3Cli, s3Resp.Bucket, s3Resp.Key);
    console.log(`${this.name} is a valid Cloudformation template`);
  }
}

var wrapWith = (wk, wv, obj) =>
  _.toPairs(obj).map((it) =>
    _.zipObject([wk, wv], it));

function unwrapOutputs(outputs) {
  return _.chain(outputs)
    .keyBy('OutputKey')
    .mapValues('OutputValue')
    .value();
}

function unwrapTags(outputs) {
  return _.chain(outputs)
    .keyBy('Key')
    .mapValues('Value')
    .value();
}

// look for template having multiple possible file extensions
async function getTemplateFile(templateDir, stackName) {
  const f = await Promise.any(
    _.map(['.yml', '.yaml', '.json', ''], async(ext) =>
      await utils.fileExists(`${path.join(templateDir, stackName)}${ext}`)));
  if (f) {
    return f;
  }
  throw new Error(`Stack template "${stackName}" not found!`);
}

// return promise that resolves to true/false or rejects with error
async function bucketExists(cli, bucket) {
  try {
    await cli.headBucket({
      Bucket: bucket
    }).promise();
    return true;
  } catch (e) {
    switch (e.statusCode) {
      case 403:
        throw new Error(
          '403: You don\'t have permissions to access this bucket');
      case 404:
        return false;
      default:
        throw e;
    }
  }
}

function createBucket(cli, bucket) {
  return cli.createBucket({
    Bucket: bucket
  }).promise();
}

async function ensureBucket(cli, bucket) {
  if (!await bucketExists(cli, bucket)) {
    await createBucket(cli, bucket);
  }
}

function s3Upload(cli, bucket, src, dest) {
  debug(`uploading ${src} to s3://${path.join(bucket, dest)}`);
  const stream = fs.createReadStream(src);
  return cli.upload({
    Bucket: bucket,
    Key: dest,
    Body: stream
  }).promise();
}

function s3Delete(cli, bucket, key) {
  debug(`deleting s3://${path.join(bucket, key)}`);
  return cli.deleteObject({
    Bucket: bucket,
    Key: key
  }).promise();
}

async function uploadLambda(cli, bucket, localFile, s3LambdaDir) {
  try {
    debug(`uploadLambda: localFile = ${localFile}`);
    const lambdaArtifact =
      `${path.basename(localFile)}.${new Date().getTime()}`;
    await ensureBucket(cli, bucket);
    return await s3Upload(cli, bucket, localFile,
      `${s3LambdaDir}/${lambdaArtifact}`);
  } catch (e) {
    throw e;
  }
}

async function awsCfStackExists(cli, stackName) {
  debug(`awsCfStackExists: stackName = ${stackName}`);
  try {
    await cli.describeStacks({
      StackName: stackName
    }).promise();
    return true;
  } catch (e) {
    if (e.message.includes('does not exist')) {
      return false;
    } else {
      console.error(`Failed at cli.describeStacks({StackName=${stackName}})`);
      throw e;
    }
  }
}

async function createAwsCfStack(cli, params) {
  console.log(`creating cloudformation stack ${params.StackName}`);
  try {
    const data = await cli.createStack(params).promise();
    // const events = await cli.describeStackEvents({ StackName: params.StackName }).promise();
    // console.log("events: ", events.StackEvents);
    await cli.waitFor('stackCreateComplete', {
      StackName: params.StackName
    }).promise();
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

async function updateAwsCfStack(cli, rawParams) {
  const params = _.omit(rawParams, ['TimeoutInMinutes']);
  console.log(`updating cloudformation stack ${params.StackName}`);
  try {
    const data = await cli.updateStack(params).promise();
    // const events = await cli.describeStackEvents({ StackName: params.StackName }).promise();
    // console.log("events: ", events.StackEvents);
    await cli.waitFor('stackUpdateComplete', {
      StackName: params.StackName
    }).promise();
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

async function awsDescribeCfStack(cli, stackName) {
  const outputs = await cli.describeStacks({
    StackName: stackName
  }).promise();
  return outputs.Stacks[0];
}

// update / create and return its info:
async function ensureAwsCfStack(cli, params) {
  if (await awsCfStackExists(cli, params.StackName)) {
    await updateAwsCfStack(cli, params);
  } else {
    await createAwsCfStack(cli, params);
  }
  const output = await awsDescribeCfStack(cli, params.StackName);
  return output;
}

async function deleteAwsCfStack(cli, params) {
  console.log(`deleting cloudformation stack ${params.StackName}`);
  try {
    const resp = await cli.deleteStack(params).promise();
    // const events = await cli.describeStackEvents({ StackName: params.StackName }).promise();
    // console.log("events: ", events.StackEvents);
    await cli.waitFor('stackDeleteComplete', {
      StackName: params.StackName
    }).promise();
    return resp;
  } catch (e) {
    throw e;
  }
}

async function validateAwsCfStack(cli, params) {
  try {
    const data = await cli.validateTemplate(params).promise();
  } catch (e) {
    throw e;
  }
}

async function getAwsRoleCreds(role, masterCreds) {
  const creds = new AWS.TemporaryCredentials({
    RoleArn: role
  }, masterCreds);
  // laziness of temp credentials causes problems
  // if this not done:
  await creds.refreshPromise();
  debug(`getAwsRoleCreds: creds = ${JSON.stringify(creds)}`);
  return creds;
}

async function getAwsCredentials(role) {
  const credentialProviderChain = new AWS.CredentialProviderChain();
  // if AWS.config.credentials is NOT null, it means
  // a file-system profile has been used, so just leave creds
  // undefined so that is used as default credentials:
  if(_.isNull(AWS.config.credentials)) {
    var creds = await credentialProviderChain.resolvePromise();
  }
  // if no role passed, return default credentials:
  if (_.isUndefined(role)) {
    debug(`getAwsCredentials: creds = ${JSON.stringify(creds)}`);
    return creds;
  }
  // else assume role:
  return getAwsRoleCreds(role, creds);
}

async function validate(stacks, envVars, nj, nodeCfConfig) {
  return Promise.all(stacks.map(async(it) => {
    const cfStack = new CfStack(it, envVars, nj, nodeCfConfig);
    await cfStack.validate();
  }));
}

async function deploy(stacks, envVars, nj, nodeCfConfig) {
  return Promise.each(stacks, async(it) => {
    const cfStack = new CfStack(it, _.cloneDeep(envVars), nj, nodeCfConfig);
    await cfStack.deploy();
    debug('stack: ', JSON.stringify(it));
    debug('envVars: ', JSON.stringify(envVars));
  });
}

async function deleteStacks(stacks, envVars, nj, nodeCfConfig) {
  return Promise.each(stacks, async(it) => {
    const cfStack = new CfStack(it, envVars, nj, nodeCfConfig);
    await cfStack.delete();
  });
}

module.exports = {
    CfStack: CfStack,
    validate: validate,
    deleteStacks: deleteStacks,
    deploy: deploy,
    getTemplateFile: getTemplateFile,
    wrapWith: wrapWith,
    unwrapOutputs: unwrapOutputs,
    unwrapTags: unwrapTags,
    awsDescribeCfStack: awsDescribeCfStack
};
