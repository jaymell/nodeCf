const assert = require('assert');
const rewire = require("rewire");
const nodeCf = rewire('../nodeCf.js');
const util = require('../util.js');
const sinon = require('sinon');
const Promise = require('bluebird');

var getTemplateFile = nodeCf.__get__('getTemplateFile');

describe('getTemplateFile', function() {
  before(function() { 
  	sinon.stub(util, 'fileExists').callsFake(function(f) { 
      console.log('f: ', f)
  	  if (f.endsWith('json')) return f
  	  throw new Error;
  	});
  });

  it('should return json extension', function() {
    return getTemplateFile('/tmp', 'test')
      .then(d => assert.equal(d, '/tmp/test.json'))
  });

  after(function() { 
  	util.fileExists.restore();
  });
});


describe('getTemplateFile', function() {
  before(function() { 
    sinon.stub(util, 'fileExists').callsFake(function(f) { 
      if (f.endsWith('yml')) return f
      throw new Error;
    });
  });

  it('should return yml extension', function() {
    return getTemplateFile('/tmp', 'test')
      .then(d => assert.equal(d, '/tmp/test.yml'))
  });

  after(function() { 
  	util.fileExists.restore();
  });
});


describe('getTemplateFile', function() {
  before(function() { 
    sinon.stub(util, 'fileExists').callsFake(function(f) { 
      if (f.endsWith('yaml')) return f
      throw new Error;
    });
  });

  it('should return yaml extension', function() {
    return getTemplateFile('/tmp', 'test')
      .then(d => assert.equal(d, '/tmp/test.yaml'))
  });

  after(function() { 
  	util.fileExists.restore();
  });
});
