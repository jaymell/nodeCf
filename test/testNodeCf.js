const assert = require('assert');
const rewire = require("rewire");
const config = require('../src/config.js');
const templater = require('../src/templater.js');
const nodeCf = rewire('../src/nodeCf.js');
const Promise = require('bluebird');

var bucketExists = nodeCf.__get__('bucketExists');
var ensureBucket = nodeCf.__get__('ensureBucket');
const wrapWith = nodeCf.__get__('wrapWith');
const getTemplateFileOrig = nodeCf.__get__('getTemplateFile');

describe('bucketExists', () => {
  it('should throw if 403 status', () => {
    // XXX: is this the best way to test a Promise rejection?
    const cli = {};
    cli.headBucket = () =>
      ({ promise: () => Promise.reject({ statusCode: 403 })});

    return bucketExists(cli, 'testBucket')
      .catch(e =>
        assert.equal(e.message,
          '403: You don\'t have permissions to access this bucket'));
  });

  it('should return false if 404', () => {
    const cli = {};
    cli.headBucket = () =>
      ({ promise: () => Promise.reject({ statusCode: 404 })});

    return bucketExists(cli, 'testBucket')
      .then(r => assert.equal(false, r));
  });

  it('should resolve to true if no exception thrown', () => {
    const cli = {};
    cli.headBucket = () =>
      ({ promise: () => Promise.resolve(null)});

    return bucketExists(cli, 'testBucket')
      .then(r => assert.equal(true, r));
  });

});

describe('test parameter wrapping', () => {
  it('input key/value pairs should return wrapped array', () => {
    const output = [
      {"ParameterKey": "Key1", "ParameterValue": "Value1"},
      {"ParameterKey": "Key2", "ParameterValue": "Value2"},
    ];
    const input = {
      Key1: "Value1",
      Key2: "Value2"
    };
    const result = wrapWith('ParameterKey', 'ParameterValue', input);
    assert.deepEqual(result, output);
  });
});

describe('CfStack', () => {
  const envVars = {
    environment: 'testEnv',
    application: 'testApp',
    account: 123456789012,
    infraBucket: 'testBucket',
    region: 'us-east-1',
  };
  const stackVars = {
    name: 'testStack',
    environment: "{{environment}}"
  };
  const nodeCfCfg = config.loadNodeCfConfig('testEnv');
  it('should instantiate successfully', () =>
    new nodeCf.CfStack(stackVars, envVars, {}, nodeCfCfg));
});

describe('CfStack', function() {
  before(() => nodeCf.__set__('getTemplateFile', () =>
    Promise.resolve('./templates/test.json')));

  const envVars = {
    environment: 'testEnv',
    application: 'testApp',
    account: 123456789012,
    infraBucket: 'testBucket',
    region: 'us-east-1',
  };
  const stackVars = {
    name: 'testStack',
    environment: "{{environment}}",
    preTasks: ["ls", "echo"]
  };
  const nodeCfCfg = config.loadNodeCfConfig('testEnv');
  after(() => nodeCf.__set__('getTemplateFile', getTemplateFileOrig));
});

describe('unwrapOutputs', () => {
  it('should return proper output', () => {
    const input = [
      {OutputKey: "Key1", OutputValue: "Value1"},
      {OutputKey: "Key2", OutputValue: "Value2", Description: "KeyValuePair2"}
    ];
    const output = { Key1: "Value1", Key2: "Value2"};
    assert.deepEqual(nodeCf.unwrapOutputs(input), output);
  });
});

describe('awsDescribeCfStack', () => {
  it('should return expected output', () => {
  /* eslint-disable */
    const mockResp = {"ResponseMetadata":{"RequestId":"f54430cd-516a-11e8-9b99-234f8526baac"},"Stacks":[{"StackId":"arn:aws:cloudformation:us-east-1:123456789012:stack/Dev-example-network/c6ce9250-516a-11e8-b8f0-50fae98a10d2","StackName":"Dev-example-network","Description":"VPC and Network Template","Parameters":[{"ParameterKey":"environment","ParameterValue":"Dev"},{"ParameterKey":"application","ParameterValue":"example"},{"ParameterKey":"VpcCidr","ParameterValue":"10.0.16.0/20"},{"ParameterKey":"PublicSubnet0Cidr","ParameterValue":"10.0.16.0/24"},{"ParameterKey":"PublicSubnet1Cidr","ParameterValue":"10.0.17.0/24"}],"CreationTime":"2018-05-06T20:19:27.911Z","RollbackConfiguration":{},"StackStatus":"CREATE_COMPLETE","DisableRollback":false,"NotificationARNs":[],"TimeoutInMinutes":10,"Capabilities":["CAPABILITY_IAM","CAPABILITY_NAMED_IAM"],"Outputs":[{"OutputKey":"PublicSubnet0AZ","OutputValue":"us-east-1a","ExportName":"Dev-example-network-PublicSubnet0AZ"},{"OutputKey":"PublicSubnet1AZ","OutputValue":"us-east-1c","ExportName":"Dev-example-network-PublicSubnet1AZ"},{"OutputKey":"Vpc","OutputValue":"vpc-84461eff","ExportName":"Dev-example-network-Vpc"},{"OutputKey":"CidrBlock","OutputValue":"10.0.16.0/20","ExportName":"Dev-example-network-CidrBlock"},{"OutputKey":"PublicSubnet1","OutputValue":"subnet-a62997ec","ExportName":"Dev-example-network-PublicSubnet1"},{"OutputKey":"PublicRT","OutputValue":"rtb-6d6c6f11","ExportName":"Dev-example-network-PublicRT"},{"OutputKey":"PublicSubnet0","OutputValue":"subnet-d23bc0b5","ExportName":"Dev-example-network-PublicSubnet0"}],"Tags":[{"Key":"environment","Value":"Dev"},{"Key":"application","Value":"example"}],"EnableTerminationProtection":false}]};
    const mockCli = {
      describeStacks: () =>
        ({
          promise: () => mockResp
        })
    };
    const expected = {"StackId":"arn:aws:cloudformation:us-east-1:123456789012:stack/Dev-example-network/c6ce9250-516a-11e8-b8f0-50fae98a10d2","StackName":"Dev-example-network","Description":"VPC and Network Template","Parameters":[{"ParameterKey":"environment","ParameterValue":"Dev"},{"ParameterKey":"application","ParameterValue":"example"},{"ParameterKey":"VpcCidr","ParameterValue":"10.0.16.0/20"},{"ParameterKey":"PublicSubnet0Cidr","ParameterValue":"10.0.16.0/24"},{"ParameterKey":"PublicSubnet1Cidr","ParameterValue":"10.0.17.0/24"}],"CreationTime":"2018-05-06T20:19:27.911Z","RollbackConfiguration":{},"StackStatus":"CREATE_COMPLETE","DisableRollback":false,"NotificationARNs":[],"TimeoutInMinutes":10,"Capabilities":["CAPABILITY_IAM","CAPABILITY_NAMED_IAM"],"Outputs":[{"OutputKey":"PublicSubnet0AZ","OutputValue":"us-east-1a","ExportName":"Dev-example-network-PublicSubnet0AZ"},{"OutputKey":"PublicSubnet1AZ","OutputValue":"us-east-1c","ExportName":"Dev-example-network-PublicSubnet1AZ"},{"OutputKey":"Vpc","OutputValue":"vpc-84461eff","ExportName":"Dev-example-network-Vpc"},{"OutputKey":"CidrBlock","OutputValue":"10.0.16.0/20","ExportName":"Dev-example-network-CidrBlock"},{"OutputKey":"PublicSubnet1","OutputValue":"subnet-a62997ec","ExportName":"Dev-example-network-PublicSubnet1"},{"OutputKey":"PublicRT","OutputValue":"rtb-6d6c6f11","ExportName":"Dev-example-network-PublicRT"},{"OutputKey":"PublicSubnet0","OutputValue":"subnet-d23bc0b5","ExportName":"Dev-example-network-PublicSubnet0"}],"Tags":[{"Key":"environment","Value":"Dev"},{"Key":"application","Value":"example"}],"EnableTerminationProtection":false};
    return nodeCf.awsDescribeCfStack(mockCli, 'testStack').then(d => assert.deepEqual(expected, d));
  /* eslint-enable */
  });
});