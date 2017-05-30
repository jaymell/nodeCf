var assert = require('assert');
var rewire = require("rewire");
var nodeCf = rewire('../nodeCf.js');
const util = require('../util.js');
const sinon = require('sinon');
var Promise = require('bluebird');

var getTemplateFile = nodeCf.__get__('getTemplateFile');

describe('getTemplateFile', function() {
  before(function() { 
  	sinon.stub(util, 'fileExists').callsFake(function(f) { 
  	  if (f.endsWith('json')) return f
  	  else throw new Error();
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
      else throw new Error();
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
      else throw new Error();
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
