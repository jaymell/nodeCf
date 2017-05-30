var assert = require('assert');
var rewire = require("rewire");
const config = require('../config.js');
var nodeCf = rewire('../nodeCf.js');
var Promise = require('bluebird');
var AWS = require('aws-sdk-mock');
AWS.Promise = Promise.Promise;

var bucketExists = nodeCf.__get__('bucketExists');
var ensureBucket = nodeCf.__get__('ensureBucket');
const wrapWith = nodeCf.__get__('wrapWith');
const getTemplateFileOrig = nodeCf.__get__('getTemplateFile');

describe('bucketExists', function() {
  before(function() { AWS.mock('S3', 'headBucket', (params, cb) => cb({ statusCode: 403 })) });

  it('should throw if 403 status', function() {
    // XXX: is this the best way to test a Promise rejection?
    return bucketExists('testBucket')
      .catch(e => 
        assert.equal(e.message, '403: You don\'t have permissions to access this bucket'))
  });

  after(() => AWS.restore('S3', 'headBucket'))
});

describe('bucketExists', function() {
  before(function() { AWS.mock('S3', 'headBucket', (params, cb) => cb({ statusCode: 404 })) });

  it('should return false if 404', function() {
    return bucketExists('testBucket')
      .then(r => assert.equal(false, r));
  });

  after(() => AWS.restore('S3', 'headBucket'))
});

describe('bucketExists', function() {
  before(function() { AWS.mock('S3', 'headBucket', (params, cb) => cb(null)) });

  it('should resolve to true if no exception thrown', function() {
    return bucketExists('testBucket')
      .then(r => assert.equal(true, r));
  });

  after(() => AWS.restore('S3', 'headBucket'))
});

describe('test parameter wrapping', function() {

  it('input key/value pairs should return wrapped array', function() {
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

describe('CfStack', function() {
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
  const nodeCfCfg = config.loadNodeCfConfig({
    environment: 'testEnv'
  });
  it('should instantiate successfully', () => {
    const stack = new nodeCf.CfStack(stackVars, nodeCfCfg);
  });
}); 

describe('CfStack', function() {
  before(function() { 
    nodeCf.__set__('getTemplateFile', () => Promise.resolve('./templates/test.json'));
  });
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
  const nodeCfCfg = config.loadNodeCfConfig({
    environment: 'testEnv'
  });
  const nj = config.loadNjEnv();
  it('load method should succeed', () => {
    const stack = new nodeCf.CfStack(stackVars, nodeCfCfg);
    return stack.load(nj, envVars, {});
  });
  it('execTasks should successfully execute working tasks', () => {
    const stack = new nodeCf.CfStack(stackVars, nodeCfCfg);
    return stack.execTasks(["ls", "echo"])
  });
  it('execTasks should throw exception for non-zero commands', () => {
    const stack = new nodeCf.CfStack(stackVars, nodeCfCfg);
    return stack.execTasks(["ls nonExistentFile", "nonExistentCommand"])
      .then(function() { throw new Error('unexpected resolve')})
      .catch(e => {
        if (e.message === 'unexpected resolve') {
          throw e
        }
      });
  });
  after(function() {
    nodeCf.__set__('getTemplateFile', getTemplateFileOrig);
  })
}); 

