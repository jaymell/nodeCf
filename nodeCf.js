const Promise = require('bluebird');
const _ = require('lodash');
const fs = Promise.promisifyAll(require('fs'));
const path = require("path");
const config = require('./config.js');
var AWS = require('aws-sdk');;
AWS.config.setPromisesDependency(Promise);

const wrap = _.curry((wk, wv, obj) => 
  _.toPairs(obj).map((it) => 
    _.zipObject([wk, wv], it)));

const wrapWith = _.curry((k, v, items) => 
  _.flatMap(items, wrap(k, v)));

class CfStack {
  constructor(stackVars, nodeCfConfig) {
    // _.merge(this, spec)
    this.name = stackVars.name;
    this.rawStackVars = stackVars;
    this.nodeCfConfig = nodeCfConfig;
    // FIXME: the following implicitly requires the stack name to not have 
    // any templated values in it (should make that explicit:
    this.template;
    getTemplateFile(nodeCfConfig.localCfTemplateDir, stackVars.name)
      .then(f => this.template = f);
  }

  // this happens just prior to deployment, so that any
  // variables needed by previously deployed stacks
  // can be used
  load(envVars, stackOutputs) {
    this.renderedStackVars = config.renderConfig(this.rawStackVars,
      _.assign(this.envVars, this.stackOutputs))
    this.infraBucket = envVars.infraBucket;
    this.parameters = wrapWith("ParameterKey", "ParameterValue", 
      this.renderedStackVars.parameters);
    this.tags = wrapWith("Key", "Value", this.renderedStackVars.tags);
    this.deployName = `${envVars.environment}-${envVars.application}-${this.name}`;
  }

  async uploadTemplate() {
    await ensureBucket(this.infraBucket);
    const timestamp = new Date().getTime();
    this.s3Location = path.join(this.nodeCfConfig.s3CfTemplateDir,
      `${this.name}-${timestamp}.yml`);
    return await s3Upload(this.infraBucket, this.template, this.s3Location);
  }

  async validate(envVars) {
    this.load(envVars);
    await ensureBucket(this.infraBucket);
    const s3Resp = await this.uploadTemplate()
    await validateAwsCfStack({
      TemplateURL: s3Resp.Location,
    });
    console.log(`${this.name} is a valid Cloudformation template`);
  }

  async deploy(envVars, stackOutputs) {
    this.load(envVars, stackOutputs);
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

// return filename if exists, else false
async function fileExists(f) {
  try {
    await fs.statAsync(f);
    return f;
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return false;
  }
}

// look for template having multiple possible file extensions
async function getTemplateFile(templateDir, stackName) {
  const f = await Promise.any(_.map(['yml', 'json', 'yaml'], async(ext) => 
    await fileExists(`${path.join(templateDir, stackName)}.${ext}`)));
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

module.exports = function(region, profile) {

  configAws({
    profile: profile,
    region: region
  });

  return {
    CfStack: CfStack,

    async validate(stacks, envVars) {
      await Promise.each(stacks, async(stack) => {
        await stack.validate(envVars);
      });
    },

    async deploy(stacks, envVars) {
      var stackOutputs = {};
      await Promise.each(stacks, async(stack) => {
        stackOutputs[stack.name] = {};
        const deployed = await stack.deploy(envVars, 
          stackOutputs);
        stackOutputs[stack.name]['outputs'] = deployed.outputs;
      });
      console.log('stackOutputs: ', _.chain(stacks).keyBy('name').value())
    },

    async delete(stacks) {
      // reverse array prior to deletion:
      await Promise.each(stacks.reverse(), async(stack) => {
        await stack.delete();
      });
    },
  };
};
