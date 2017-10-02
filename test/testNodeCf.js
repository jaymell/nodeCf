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
    new nodeCf.CfStack(stackVars, nodeCfCfg));
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

