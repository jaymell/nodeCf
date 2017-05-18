const Promise = require('bluebird');
const _ = require('lodash');
const fs = Promise.promisifyAll(require('fs'));
const path = require("path");
var AWS = require('aws-sdk');;
AWS.config.setPromisesDependency(Promise);

const wrap = _.curry((wk, wv, obj) => _.toPairs(obj).map((it) => _.zipObject([wk, wv], it)))
const wrapWith = _.curry((k, v, items) => _.flatMap(items, wrap(k, v)))

class CfStack {
  constructor(spec) {
    _.merge(this, spec)
    this.parameters = wrapWith("ParameterKey", "ParameterValue", spec.parameters)
    this.tags = wrapWith("Key", "Value", spec.tags)
    this.deployName = `${spec.environment}-${spec.application}-${spec.name}`;
  }
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
  console.log(`uploading template ${src} to s3://${bucket}/${dest}`);
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
  return await cli.describeStacks({
    StackName: params.StackName
  }).promise()
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
  else throw new Error('Stack template not found!'); 
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

module.exports = function(params) {

  const env = params.env;
  const region = params.region;
  const profile = params.profile;
  var envVars = params.envVars;
  var globalVars = params.globalVars;
  var stackVars = params.stackVars;
  var nodeCfConfig = params.nodeCfConfig;

  configAws({
    profile: profile,
    region: region
  });

  const envConfig = loadEnvConfig(env, region, globalVars, envVars, envConfigSchema);
  const stackConfig = loadStackConfig(stackVars, envConfig, cfStackConfigSchema);
  // TODO: add validator for nodeCfConfig:
  nodeCfConfig = nodeCfConfig || defaultNodeCfConfig(envConfig.application,
    envConfig.environment);
  const stacks = _.map(stackConfig, v => new CfStack(v));
  const infraBucket = envConfig.infraBucket;
  const srcDir = nodeCfConfig.localCfTemplateDir;
  const destDir = nodeCfConfig.s3CfTemplateDir;

  return {
    envConfig: envConfig,
    stackConfig: stackConfig,
    nodeCfConfig: nodeCfConfig,
    stacks: stacks,

    async validate() {
      await ensureBucket(infraBucket);
      await Promise.each(stacks, async(stack) => {
        const src = await getTemplateFile(srcDir, stack.name);
        const timestamp = new Date().getTime();
        const dest = `${destDir}/${stack.name}-${timestamp}.yml`;
        const s3Resp = await s3Upload(infraBucket, src, dest);
        console.log(`validating cloudformation stack ${src}`);
        await validateAwsCfStack({
          TemplateURL: s3Resp.Location,
        });
        console.log(`${src} is a valid Cloudformation template`);
      });
    },

    async delete() {
      // reverse array prior to deletion:
      await Promise.each(stacks.reverse(), async(stack) => {
        await deleteAwsCfStack({
          StackName: stack.deployName
        });
        console.log(`deleted ${stack.deployName}`);
      })
    },

    async deploy() {
      await ensureBucket(infraBucket);
      await Promise.each(stacks, async(stack) => {
        const src = await getTemplateFile(srcDir, stack.name);
        const timestamp = new Date().getTime();
        const dest = `${destDir}/${stack.name}-${timestamp}.yml`;
        const s3Resp = await s3Upload(infraBucket, src, dest);
        const stackResp = await ensureAwsCfStack({
          StackName: stack.deployName,
          Parameters: stack.parameters,
          Tags: stack.tags,
          TemplateURL: s3Resp.Location,
          Capabilities: [ 'CAPABILITY_IAM', 
            'CAPABILITY_NAMED_IAM' ]
        });
        stack.parameters = 
        stack.outputs = 
        console.log(`deployed ${stack.deployName}`);
      });
    }
  };
};
