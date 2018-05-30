const assert = require('assert');
const child_process = require('child_process');
const _ = require('lodash');
const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const yaml = require('js-yaml');
const run = require('../src/run.js');
const nodeCf = require('../src/nodeCf.js');
const AWS = require('aws-sdk');
AWS.config.setPromisesDependency(Promise);

function getAwsParams() {
  const config = { region: "us-east-1" };
  const profile = process.env.profile;
  if (! (_.isUndefined(profile) )) {
    const credentials = new AWS.SharedIniFileCredentials({
        profile: profile
      });
    config.credentials = credentials;
  }
  return config;
}

function getCommand(env,
                    infraBucket=process.env.infraBucket,
                    region="us-east-1",
                    task="deploy") {

  const profile = process.env.profile;
  if ( ! (_.isUndefined(profile) )) {
    /* eslint-disable */
    return `node ../index.js -e ${env} -r ${region} -p ${profile} -x infraBucket=${infraBucket} ${task}`;
    /* eslint-enable */
  }
    return `node ../index.js -e ${env} -r ${region} -x infraBucket=${infraBucket} ${task}`;
}

async function runCommand(cmd, envVars={}) {
  return new Promise((res, rej) =>
    child_process.exec(cmd,
                      { cwd: "./integration", shell: true, env: envVars },
                      (err, stdout, stderr) => {
      if ( ! (_.isNull(err)) ) {
        console.log(stdout, stderr);
        return rej(err);
      }
      return res({ stdout: stdout.split("\n"), stderr: stderr.split("\n") });
    }));
}

describe('stack deployment using config file defaults', function() {
  this.timeout(1000 * 60 * 45);
  it('should succeeed and return expected output', async() => {
    const cmd = getCommand("Dev");
    try {
      const { stdout, stderr } = await runCommand(cmd, { lambdaArtifact: "./lambda.zip" });
      const awsParams = getAwsParams();
      const cfCli = new AWS.CloudFormation(awsParams);
      const networkOutputs = nodeCf.unwrapOutputs(
        (await nodeCf.awsDescribeCfStack(cfCli, "Dev-example-network")).Outputs);
      const infra1Outputs = nodeCf.unwrapOutputs(
        (await nodeCf.awsDescribeCfStack(cfCli, "Dev-example-infra1")).Outputs);
      const lambda1Outputs = nodeCf.unwrapOutputs(
        (await nodeCf.awsDescribeCfStack(cfCli, "Dev-example-lambda1")).Outputs);
      const expected = [
        "Failed to load nodecf config fom file. Using default configuration. ",
        "deploying Dev-example-network",
        "creating cloudformation stack Dev-example-network",
        "deployed Dev-example-network",
        "deploying Dev-example-infra1",
        "running creationTasks...",
        `infra1 creation ${networkOutputs.Vpc}`,
        "running preTasks...",
        `infra1 pre ${networkOutputs.Vpc}`,
        "creating cloudformation stack Dev-example-infra1",
        "running postTasks...",
        `infra1 post ${infra1Outputs.SecurityGroup}`,
        `infra1 post ${networkOutputs.Vpc}`,
        "deployed Dev-example-infra1",
        "deploying Dev-example-lambda1",
        "running creationTasks...",
        `lambda1 creation ${networkOutputs.Vpc}`,
        "running preTasks...",
        `lambda1 pre ${networkOutputs.Vpc}`,
        "creating cloudformation stack Dev-example-lambda1",
        "running postTasks...",
        `lambda1 post ${lambda1Outputs.Lambda}`,
        `lambda1 post ${networkOutputs.Vpc}`,
        "deployed Dev-example-lambda1",
        "" ];
      assert.deepEqual(expected, stdout);
    }
    finally {
      // clean up
      const cmd = getCommand("Dev", undefined, undefined, task="delete");
      await runCommand(cmd);
    }
  });
});

describe('stack deployment passing stacks as environment variables', function() {
  this.timeout(1000 * 60 * 45);
  it('should succeeed and return expected output', async() => {
    const cmd = getCommand("Dev");
    try {
      const { stdout, stderr } = await runCommand(cmd,
                                                  { stacks: "network lambda1",
                                                    lambdaArtifact: "./lambda.zip" });
      const awsParams = getAwsParams();
      const cfCli = new AWS.CloudFormation(awsParams);
      const networkOutputs = nodeCf.unwrapOutputs(
        (await nodeCf.awsDescribeCfStack(cfCli, "Dev-example-network")).Outputs);
      const lambda1Outputs = nodeCf.unwrapOutputs(
        (await nodeCf.awsDescribeCfStack(cfCli, "Dev-example-lambda1")).Outputs);
      const expected = [
        "Failed to load nodecf config fom file. Using default configuration. ",
        "deploying Dev-example-network",
        "creating cloudformation stack Dev-example-network",
        "deployed Dev-example-network",
        "deploying Dev-example-lambda1",
        "running creationTasks...",
        `lambda1 creation ${networkOutputs.Vpc}`,
        "running preTasks...",
        `lambda1 pre ${networkOutputs.Vpc}`,
        "creating cloudformation stack Dev-example-lambda1",
        "running postTasks...",
        `lambda1 post ${lambda1Outputs.Lambda}`,
        `lambda1 post ${networkOutputs.Vpc}`,
        "deployed Dev-example-lambda1",
        "" ];
      assert.deepEqual(expected, stdout);
    }
    finally {
      // clean up
      const cmd = getCommand("Dev", undefined, undefined, task="delete");
      await runCommand(cmd, { stacks: "network lambda1" } );
    }
  });
});


describe('stacks deployed with custom config file', function() {

  this.timeout(1000 * 60 * 45);
  const configFile = "./integration/config/config.yml";

  before(async() => {
    const configContent = {
      stackDefaults: {
          tags: {
            customTagKey: "customTagValue"
          }
        }
    };
    return await fs.writeFileAsync(configFile, yaml.safeDump(configContent));
  });

  it('should merge tags in custom config file with defaults', async() => {
    const cmd = getCommand("Dev");
    try {
      const { stdout, stderr } = await runCommand(cmd, { stacks: "network" });
      const awsParams = getAwsParams();
      const cfCli = new AWS.CloudFormation(awsParams);
      const networkTags = nodeCf.unwrapTags(
        (await nodeCf.awsDescribeCfStack(cfCli, "Dev-example-network")).Tags);
      assert.deepEqual("customTagValue", networkTags.customTagKey);
      assert.deepEqual("Dev", networkTags.environment);
      assert.deepEqual("example", networkTags.application);
    }
    finally {
      // clean up
      const cmd = getCommand("Dev", undefined, undefined, task="delete");
      await runCommand(cmd, { stacks: "network lambda1" } );
    }
  });

  after(async() => {
    return await fs.unlinkAsync(configFile);
  });

});
