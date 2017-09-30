const assert = require('assert');
const rewire = require("rewire");
const nodeCf = rewire('../src/nodeCf.js');
const utils = require('../src/utils.js');
const sinon = require('sinon');
const Promise = require('bluebird');

var getTemplateFile = nodeCf.__get__('getTemplateFile');

describe('getTemplateFile', function() {
  before(function() {
  	sinon.stub(utils, 'fileExists').callsFake(function(f) {
  	  if (f.endsWith('.json')) return Promise.resolve(f);
      return Promise.reject();
  	});
  });

  it('should return json extension', function() {
    return getTemplateFile('/tmp', 'test')
      .then(d => assert.equal(d, '/tmp/test.json'));
  });

  after(function() {
  	utils.fileExists.restore();
  });
});


describe('getTemplateFile', function() {
  before(function() {
    sinon.stub(utils, 'fileExists').callsFake(function(f) {
      if (f.endsWith('.yml')) return Promise.resolve(f);
      return Promise.reject();
    });
  });

  it('should return yml extension', function() {
    return getTemplateFile('/tmp', 'test')
      .then(d => assert.equal(d, '/tmp/test.yml'));
  });

  after(function() {
  	utils.fileExists.restore();
  });
});


describe('getTemplateFile', function() {
  before(function() {
    sinon.stub(utils, 'fileExists').callsFake(function(f) {
      if (f.endsWith('.yaml')) return Promise.resolve(f);
      return Promise.reject();
    });
  });

  it('should return yaml extension', function() {
    return getTemplateFile('/tmp', 'test')
      .then(d => assert.equal(d, '/tmp/test.yaml'));
  });

  after(function() {
  	utils.fileExists.restore();
  });
});


describe('getTemplateFile', function() {
  before(function() {
    sinon.stub(utils, 'fileExists').callsFake(function(f) {
      if ( f == '/tmp/test.json' ) {
        return Promise.resolve(f);
      }
      return Promise.reject();
    });
  });

  it('should return file name if full name + extension passed', function() {
    return getTemplateFile('/tmp', 'test.json')
      .then(d => assert.equal(d, '/tmp/test.json'));
  });

  after(function() {
    utils.fileExists.restore();
  });
});
