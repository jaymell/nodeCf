const assert = require('assert');
const rewire = require("rewire");
const config = require('../config.js');
const nodeCf = rewire('../nodeCf.js');
const schema = rewire('../schema.js');
const Promise = require('bluebird');

const cfStackConfigSchema = schema.__get__('cfStackConfigSchema');
const envConfigSchema = schema.__get__('envConfigSchema');

const mockCfg = {
    localCfTemplateDir: `./templates`,
    localCfgDir: `./config`,
    globalCfg: `./config/global.yml`,
    stackCfg: `./config/stacks.yml`,
    s3CfTemplateDir: `/test/templates`,
    s3LambdaDir: `/test/lambda`
};

describe('cfStackConfigSchema', () => {
  describe('name', () => {
    it('should not have underscores', () => {
      assert.equal(false,
        config.isValidJsonSchema(cfStackConfigSchema, {
          name: "te_st"
        }));
    });
    it('should pass with only alphanumerics and dashes', () => {
      assert.equal(true,
        config.isValidJsonSchema(cfStackConfigSchema, {
          name: "test-0123"
        }));
    });
    it('should fail if not present', () => {
      assert.equal(false,
        config.isValidJsonSchema(cfStackConfigSchema, {
          tags: [{
            "tag1": "test1"
          }, {
            "tag2": "test2"
          }]
        }));
    });
  });

  describe('tags', function() {
    it('should fail if just a string', () => {
      assert.equal(false,
        config.isValidJsonSchema(cfStackConfigSchema, {
          name: "test",
          tags: "mytags"
        }));
    });
    it('should fail if an array of key/value pairs', () => {
      assert.equal(false,
        config.isValidJsonSchema(cfStackConfigSchema, {
          name: "test",
          tags: [{
            "tag1": "test1"
          }, {
            "tag2": "test2"
          }]
        }));
    });
    it('should pass if an object', () => {
      assert.equal(true,
        config.isValidJsonSchema(cfStackConfigSchema, {
          name: "test",
          tags: {
            "tag1": "test1",
            "tag2": "test2"
          }
        }));
    });
    it('should wrap tags with Key and Value property names', () => {
      const spec = {
        name: "test",
        parameters: {},
        tags: {
          "tag1": "test1",
          "tag2": "test2"
        }
      }

      assert.deepEqual(nodeCf.wrapWith('Key', 'Value', spec.tags), [
        {"Key": "tag1", "Value": "test1"},
        {"Key": "tag2", "Value": "test2"}
      ])
    })
  });

  describe('parameters', () => {
    it('should fail if just a string', () => {
      assert.equal(false,
        config.isValidJsonSchema(cfStackConfigSchema, {
          name: "test",
          parameters: "myparameters"
        }));
    });
    it('should fail if an array of key/value pairs', () => {
      assert.equal(false,
        config.isValidJsonSchema(cfStackConfigSchema, {
          name: "test",
          parameters: [{
            "tag1": "test1"
          }, {
            "tag2": "test2"
          }]
        }));
    });
    it('should pass if an object', () => {
      assert.equal(true,
        config.isValidJsonSchema(cfStackConfigSchema, {
          name: "test",
          parameters: {
            "tag1": "test1",
            "tag2": "test2"
          }
        }));
    });
    it('should wrap parameters with ParameterKey and ParameterValue property names', () => {
      const spec = {
        name: "test",
        parameters: {
          "tag1": "test1",
          "tag2": "test2"
        }
      }

      assert.deepEqual(nodeCf.wrapWith('ParameterKey', 'ParameterValue', spec.parameters), [
        {"ParameterKey": "tag1", "ParameterValue": "test1"},
        {"ParameterKey": "tag2", "ParameterValue": "test2"}
      ])
    })
  });
});

describe('envConfigSchema', () => {
  it('should fail if no application', () => {
    assert.equal(false,
      config.isValidJsonSchema(envConfigSchema, {
        account: 'test',
        environment: 'test',
        infraBucket: 'test'
      }));
  });

  it('should fail if no environment', () => {
    assert.equal(false,
      config.isValidJsonSchema(envConfigSchema, {
        account: 'test',
        application: 'test',
        infraBucket: 'test'
      }));
  });

  it('should fail if no account', () => {
    assert.equal(false,
      config.isValidJsonSchema(envConfigSchema, {
        application: 'test',
        environment: 'test',
        infraBucket: 'test'
      }));
  });

  it('should fail if no infraBucket', () => {
    assert.equal(false,
      config.isValidJsonSchema(envConfigSchema, {
        application: 'test',
        environment: 'test',
        account: 'test'
      }));
  });
  it('should pass if all required passed', () => {
    assert.equal(false,
      config.isValidJsonSchema(envConfigSchema, {
        application: 'test',
        environment: 'test',
        infraBucket: 'test',
        account: 'test'
      }));
  });
});

