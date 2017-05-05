var assert = require('assert');
var rewire = require("rewire");
var nodeCf = rewire('../nodeCf.js');
var Promise = require('bluebird');
var AWS = require('aws-sdk-mock');
AWS.Promise = Promise;

var bucketExists = nodeCf.__get__('bucketExists');
var ensureBucket = nodeCf.__get__('ensureBucket');

var mock200Cli = {
  headBucket: function(params) { 
    return { promise: function() { return Promise.resolve() }}}
};

var mock404Cli = {
	headBucket: function(params) { 
    return { promise: function() { return Promise.reject({ statusCode: 404 }) }}}
};


var mock403Cli = {
	headBucket: function(params) { 
    return { promise: function() { return Promise.reject({ statusCode: 403 }) }}}
};

describe('bucketExists', function() {
  it('should throw if 403 status', function() {
    // XXX: is this the best way to test a Promise rejection?
    return bucketExists(mock403Cli, { Bucket: 'testBucket'})
      .catch(e => 
        assert.equal(e.message, '403: You don\'t have permissions to access this bucket'))
  });

  it('should return false if 404', function() {
    return bucketExists(mock404Cli, {Bucket: 'testBucket'})
      .then(r => assert.equal(false, r));
  });

  it('should resolve to true if no exception thrown', function() {
    return bucketExists(mock200Cli, {Bucket: 'testBucket'})
      .then(r => assert.equal(true, r));
  });
});

