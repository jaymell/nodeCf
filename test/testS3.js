var assert = require('assert');
var rewire = require("rewire");
var nodeCf = rewire('../nodeCf.js');
var Promise = require('bluebird');
var AWS = require('aws-sdk-mock');
AWS.Promise = Promise.Promise;

var bucketExists = nodeCf.__get__('bucketExists');
var ensureBucket = nodeCf.__get__('ensureBucket');

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

