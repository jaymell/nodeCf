var assert = require('assert');
var rewire = require("rewire");
var nodeCf = rewire('../nodeCf.js');

var isValidJsonSchema = nodeCf.__get__('isValidJsonSchema');
var cfStackConfigSchema = nodeCf.__get__('cfStackConfigSchema');
var envConfigSchema = nodeCf.__get__('envConfigSchema');

describe('cfStackConfigSchema', () => {
  describe('name', () => {
    it('should not have underscores', () => {
      assert.equal(false,
        isValidJsonSchema(cfStackConfigSchema, {
          name: "te_st"
        }));
    });
    it('should pass with only alphanumerics and dashes', () => {
      assert.equal(true,
        isValidJsonSchema(cfStackConfigSchema, {
          name: "test-0123"
        }));
    });
    it('should fail if not present', () => {
      assert.equal(false,
        isValidJsonSchema(cfStackConfigSchema, {
          tags: [{
            "tag1": "test1"
          }, {
            "tag2": "test2"
          }]
        }));
    });
  });

  describe('tags', function() {
    it('should fail if not an array', () => {
      assert.equal(false,
        isValidJsonSchema(cfStackConfigSchema, {
          name: "test",
          tags: "mytags"
        }));
    });
    it('should fail if not an array of key/value pairs', () => {
      assert.equal(false,
        isValidJsonSchema(cfStackConfigSchema, {
          name: "test",
          tags: ["mytags"]
        }));
    });
    it('should pass if an array of key/value pairs', () => {
      assert.equal(true,
        isValidJsonSchema(cfStackConfigSchema, {
          name: "test",
          tags: [{
            "tag1": "test1"
          }, {
            "tag2": "test2"
          }]
        }));
    });
  });

  describe('parameters', () => {
    it('should fail if not an array', () => {
      assert.equal(false,
        isValidJsonSchema(cfStackConfigSchema, {
          name: "test",
          parameters: "myparameters"
        }));
    });
    it('should fail if not an array of key/value pairs', () => {
      assert.equal(false,
        isValidJsonSchema(cfStackConfigSchema, {
          name: "test",
          parameters: ["myparameters"]
        }));
    });
    it('should pass if an array of key/value pairs', () => {
      assert.equal(true,
        isValidJsonSchema(cfStackConfigSchema, {
          name: "test",
          parameters: [{
            "tag1": "test1"
          }, {
            "tag2": "test2"
          }]
        }));
    });
  });

});

describe('envConfigSchema', () => {
  it('should fail if no application', () => {
    assert.equal(false,
      isValidJsonSchema(envConfigSchema, {
        account: 'test',
        environment: 'test',
        infraBucket: 'test'
      }));
  });

  it('should fail if no environment', () => {
    assert.equal(false,
      isValidJsonSchema(envConfigSchema, {
        account: 'test',
        application: 'test',
        infraBucket: 'test'
      }));
  });

  it('should fail if no account', () => {
    assert.equal(false,
      isValidJsonSchema(envConfigSchema, {
        application: 'test',
        environment: 'test',
        infraBucket: 'test'
      }));
  });

  it('should fail if no infraBucket', () => {
    assert.equal(false,
      isValidJsonSchema(envConfigSchema, {
        application: 'test',
        environment: 'test',
        account: 'test'
      }));
  });
  it('should pass if all required passed', () => {
    assert.equal(false,
      isValidJsonSchema(envConfigSchema, {
        application: 'test',
        environment: 'test',
        infraBucket: 'test',
        account: 'test'
      }));
  });
});
