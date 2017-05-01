var assert = require('assert');
var nodeCf = require('../nodeCf.js');

describe('cfStackSchema', function() {
  describe('name', function() {
    it('should not have underscores', function() {
      assert.throws(() => nodeCf.cfStack({ name: "te_st", 
               account: "12345", 
               environment: "test",
               application: "test",
             }), /Stack does not match schema/);
    });
    it('should pass with only alphanumerics and dashes', function() {
      assert.doesNotThrow(() => nodeCf.cfStack({ name: "test-0123", 
               account: "12345", 
               environment: "test",
               application: "test",
             }));
    });
  });
  describe('tags', function() {
    it('should fail if not an array', function() {
      assert.throws(() => nodeCf.cfStack({ name: "test", 
               account: "12345", 
               environment: "test",
               application: "test",
               tags: "mytags"
             }), /Stack does not match schema/);
    });
    it('should fail if not an array of key/value pairs', function() {
      assert.throws(() => nodeCf.cfStack({ name: "test", 
               account: "12345", 
               environment: "test",
               application: "test",
               tags: ["mytags"]
             }), /Stack does not match schema/);
    });
    it('should pass if an array of key/value pairs', function() {
      assert.doesNotThrow(() => nodeCf.cfStack({ name: "test", 
               account: "12345", 
               environment: "test",
               application: "test",
               tags: [{"tag1": "test1"}, {"tag2": "test2"}]
             }));
    });
  });
  describe('parameters', function() {
    it('should fail if not an array', function() {
      assert.throws(() => nodeCf.cfStack({ name: "test", 
               account: "12345", 
               environment: "test",
               application: "test",
               parameters: "myparameters"
             }), /Stack does not match schema/);
    });
    it('should fail if not an array of key/value pairs', function() {
      assert.throws(() => nodeCf.cfStack({ name: "test", 
               account: "12345", 
               environment: "test",
               application: "test",
               parameters: ["myparameters"]
             }), /Stack does not match schema/);
    });
    it('should pass if an array of key/value pairs', function() {
      assert.doesNotThrow(() => nodeCf.cfStack({ name: "test", 
               account: "12345", 
               environment: "test",
               application: "test",
               parameters: [{"tag1": "test1"}, {"tag2": "test2"}]
             }));
    });
  });
});
