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
    this.rawStackVars = stackVars;
    this.envVars = envVars;
    this.nj = nj;
    this.nodeCfConfig = nodeCfConfig;
    this.schema = schema.cfStackConfigSchema;
    this.infraBucket = envVars.infraBucket;
    this.deployName =
      `${envVars.environment}-${envVars.application}-${this.name}`;
  }

  async getAwsCredentials(role) {
    debug(`CfStack.getAwsCredentials -- role: ${role}`);
    const creds = await getAwsCredentials(role);
    return creds;
  }

  async lateInit() {
    this.template = await getTemplateFile(this.nodeCfConfig.localCfTemplateDir,
      this.rawStackVars.templateName || this.rawStackVars.name);
    // if role defined at stack level, use that, otherwise
    // use one at environment level (which itself could be undefined):
    const rawRole = this.rawStackVars.role || this.envVars.role;
    // ensure any template vars in role are processed:
    if (!(_.isUndefined(rawRole))) var role = await this.renderObj(rawRole);
    this.credentials = await this.getAwsCredentials(role);
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

  async validate() {
    await this.lateInit();
    const s3Cli = await this.getAwsClient('S3');
    const cfCli = await this.getAwsClient('CloudFormation');
    const s3Resp = await this.uploadTemplate(s3Cli);
    debug('s3Resp: ', s3Resp);
    await validateAwsCfStack(cfCli, {
      TemplateURL: s3Resp.Location,
    });
    console.log(`${this.name} is a valid Cloudformation template`);
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

  async renderList(vars, extraRenderVars) {
    // pass in optional extra vars to be used for rendering:
    return templater.renderList(this.nj, vars,
      _.merge(this.envVars, extraRenderVars));
  }

  async renderObj(vars, extraRenderVars) {
    // pass in optional extra vars to be used for rendering:
    return templater.renderObj(this.nj, vars,
      _.merge(this.envVars, extraRenderVars));
  }

  async doTasks(tasks, label) {
    // render and run tasks
    debug(`CfStack.doTasks: calling ${label}`);
    const renderedTasks = await this.renderList(tasks);
    await utils.execTasks(renderedTasks, label);
    debug(`CfStack.doTasks: returning from ${label}`);
  }

  async doPostTasks(tasks, stackExports, label) {
    // render and run tasks
    debug(`CfStack.doPostTasks: calling ${label}`);
    const renderedTasks = await this.renderList(tasks, stackExports);
    await utils.execTasks(renderedTasks, label);
    debug(`CfStack.doPostTasks: returning from ${label}`);
  }

  // these only run if stack didn't already exist:
  async doCreationTasks(cli, tasks, label) {
    if (!(await awsCfStackExists(cli, this.deployName))) {
      await this.doTasks(tasks, label);
    }
  }

  async doStackDeploy(s3Cli, cfCli, lambdaVars) {
    // render and wrap parameters and tags
    debug(`CfStack.doStackDeploy: ${JSON.stringify(lambdaVars)}`);
    const parameters = wrapWith("ParameterKey", "ParameterValue",
      await this.renderObj(this.rawStackVars.parameters, lambdaVars));
    const tags = wrapWith("Key", "Value",
      await this.renderObj(this.rawStackVars.tags));
    // deploy stack
    const s3Resp = await this.uploadTemplate(s3Cli);
    const stackResp = await ensureAwsCfStack(cfCli, {
      StackName: this.deployName,
      Parameters: parameters,
      Tags: tags,
      TemplateURL: s3Resp.Location,
      Capabilities: this.rawStackVars.capabilities,
      TimeoutInMinutes: this.rawStackVars.timeout
    });
    const outputs = unwrapOutputs(stackResp.Outputs);
    return outputs;
  }

  async deploy() {
    console.log(`deploying ${this.deployName}`);

    await this.lateInit();

    const s3Cli = await this.getAwsClient('S3');
    const cfCli = await this.getAwsClient('CloudFormation');
    const stackExportsObj = {};
    const stackExports = stackExportsObj[this.name] = {};
    const lambdaVars = {};

    // add dependencies to envVars.stacks:
    _.assign(this.envVars.stacks,
      (await this.doDependencies(cfCli, this.rawStackVars.stackDependencies)));
    // add lambda helpers to stack exports:
    lambdaVars.lambda =
      await this.doLambdaArtifacts(s3Cli, this.rawStackVars.lambdaArtifact);
    // creation tasks:
    await this.doCreationTasks(cfCli, this.rawStackVars.creationTasks,
      'creationTasks');
    // pre-tasks:
    await this.doTasks(this.rawStackVars.preTasks, 'preTasks');
    // deploy stack:
    stackExports.outputs = await this.doStackDeploy(s3Cli, cfCli, lambdaVars);
    // post-tasks:
    await this.doPostTasks(this.rawStackVars.postTasks,
      stackExports, 'postTasks');

    console.log(`deployed ${this.deployName}`);

    return stackExports;
  }

  async delete() {
    await this.lateInit();
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
  debug(`uploading template ${src} to s3://${path.join(bucket, dest)}`);
  const stream = fs.createReadStream(src);
  return cli.upload({
    Bucket: bucket,
    Key: dest,
    Body: stream
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

function configAws(params) {
  if (typeof params.profile !== 'undefined' && params.profile) {
    const credentials = new AWS.SharedIniFileCredentials({
      profile: params.profile
    });
    AWS.config.credentials = credentials;
  }
  AWS.config.update({
    region: params.region
  });
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

async function validate(stackVars, envVars, nj, nodeCfConfig) {
  if (_.isEmpty(stackVars)) return envVars;
  const cfStack = new CfStack(stackVars[0], envVars, nj, nodeCfConfig);
  await cfStack.validate();
  // recurse:
  return validate(stackVars.slice(1), envVars, nj, nodeCfConfig);
}

async function deploy(stackVarsList, envVars, nj, nodeCfConfig) {
  if (_.isEmpty(stackVarsList)) return envVars;
  if (_.isUndefined(envVars.stacks) ) envVars.stacks = {};
  const cfStack = new CfStack(stackVarsList[0], envVars, nj, nodeCfConfig);
  // merge envVars.stacks with stack outputs returned after deploying
  // individual stack:
  _.assign(envVars, (await cfStack.deploy()));
  debug('envVars: ', JSON.stringify(envVars));
  // recurse:
  return deploy(stackVarsList.slice(1), envVars, nj, nodeCfConfig);
}

async function deleteStacks(stackVars, envVars, nj, nodeCfConfig) {
  if (_.isEmpty(stackVars)) return envVars;
  const cfStack = new CfStack(stackVars[0], envVars, nj, nodeCfConfig);
  await cfStack.delete();
  // recurse:
  return deleteStacks(stackVars.slice(1), envVars, nj, nodeCfConfig);
}

module.exports = {
    configAws: configAws,
    CfStack: CfStack,
    validate: validate,
    deleteStacks: deleteStacks,
    deploy: deploy,
    getTemplateFile: getTemplateFile,
    wrapWith: wrapWith,
    unwrapOutputs: unwrapOutputs
};
