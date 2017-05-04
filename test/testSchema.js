var assert = require('assert');
var rewire = require("rewire");
var nodeCf = rewire('../nodeCf.js');

var isValidJsonSchema = nodeCf.__get__('isValidJsonSchema');
var cfStackConfigSchema = nodeCf.__get__('cfStackConfigSchema');
var envConfigSchema = nodeCf.__get__('envConfigSchema');

describe('cfStackConfigSchema', function() {
  describe('name', function() {
    it('should not have underscores', function() {
      assert.equal(false, 
                   isValidJsonSchema(cfStackConfigSchema, 
                                     { name: "te_st" }))
    });
    it('should pass with only alphanumerics and dashes', function() {
      assert.equal(true, 
        isValidJsonSchema(cfStackConfigSchema, 
                          { name: "test-0123" }))
    });
    it('should fail if not present', function() {
      assert.equal(false, 
        isValidJsonSchema(cfStackConfigSchema, 
                           { tags: [{"tag1": "test1"}, 
                                    {"tag2": "test2"}]
                           }));
    });
  });

  describe('tags', function() {
    it('should fail if not an array', function() {
      assert.equal(false, 
                   isValidJsonSchema(cfStackConfigSchema,  
                                     { name: "test", 
                                       tags: "mytags" }));
    });
    it('should fail if not an array of key/value pairs', function() {
      assert.equal(false, 
                   isValidJsonSchema(cfStackConfigSchema, 
                    { name: "test", 
                      tags: ["mytags"] }));
    });
    it('should pass if an array of key/value pairs', function() {
      assert.equal(true, 
                   isValidJsonSchema(cfStackConfigSchema, 
                                     { name: "test", 
                                       tags: [{"tag1": "test1"}, 
                                              {"tag2": "test2"}]
                                     }));
    });
  });

  describe('parameters', function() {
    it('should fail if not an array', function() {
      assert.equal(false, 
                  isValidJsonSchema(cfStackConfigSchema, 
                                    { name: "test", 
                                      parameters: "myparameters"
                                    }));
    });
    it('should fail if not an array of key/value pairs', function() {
      assert.equal(false, 
                   isValidJsonSchema(cfStackConfigSchema, 
                                     { name: "test", 
                                       parameters: ["myparameters"]
                                     }));
    });
    it('should pass if an array of key/value pairs', function() {
      assert.equal(true, 
                   isValidJsonSchema(cfStackConfigSchema, 
                                     { name: "test", 
                                       parameters: [{"tag1": "test1"}, 
                                                    {"tag2": "test2"}]
                                     }));
    });
  });

});

describe('envConfigSchema', function() {
  it('should fail if no application', function() {
    assert.equal(false, 
                 isValidJsonSchema(envConfigSchema,
                                   { account: 'test',
                                     environment: 'test',
                                     infraBucket: 'test'}));
  });

  it('should fail if no environment', function() {
    assert.equal(false, 
                 isValidJsonSchema(envConfigSchema,
                                   { account: 'test',
                                     application: 'test',
                                     infraBucket: 'test'}));
  });

  it('should fail if no account', function() {
    assert.equal(false, 
                 isValidJsonSchema(envConfigSchema,
                                   { application: 'test',
                                     environment: 'test',
                                     infraBucket: 'test'}));
  });

  it('should fail if no infraBucket', function() {
    assert.equal(false, 
                 isValidJsonSchema(envConfigSchema,
                                   { application: 'test',
                                     environment: 'test',
                                     account: 'test'}));  
  });
  it('should pass if all required passed', function() {
    assert.equal(false, 
                 isValidJsonSchema(envConfigSchema,
                                   { application: 'test',
                                     environment: 'test',
                                     infraBucket: 'test',
                                     account: 'test'}));  
  });
});
