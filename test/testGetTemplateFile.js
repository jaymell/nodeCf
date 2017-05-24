var assert = require('assert');
var rewire = require("rewire");
var nodeCf = rewire('../nodeCf.js');
var Promise = require('bluebird');

var getTemplateFile = nodeCf.__get__('getTemplateFile');
var fileExistsOrig = nodeCf.__get__('fileExists');


describe('getTemplateFile', function() {
  before(function() { 
  	nodeCf.__set__('fileExists', function(f) { 
  	  if (f.endsWith('json')) return f
  	  else throw new Error();
  	});
  });

  it('should return json extension', function() {
    return getTemplateFile('/tmp', 'test')
      .then(d => assert.equal(d, '/tmp/test.json'))
  });

  after(function() { 
  	nodeCf.__set__('fileExists', fileExistsOrig);
  });
});


describe('getTemplateFile', function() {
  before(function() { 
    nodeCf.__set__('fileExists', function(f) { 
      if (f.endsWith('yml')) return f
      else throw new Error();
    });
  });

  it('should return yml extension', function() {
    return getTemplateFile('/tmp', 'test')
      .then(d => assert.equal(d, '/tmp/test.yml'))
  });

  after(function() { 
  	nodeCf.__set__('fileExists', fileExistsOrig);
  });
});


describe('getTemplateFile', function() {
  before(function() { 
    nodeCf.__set__('fileExists', function(f) { 
      if (f.endsWith('yaml')) return f
      else throw new Error();
    });
  });

  it('should return yaml extension', function() {
    return getTemplateFile('/tmp', 'test')
      .then(d => assert.equal(d, '/tmp/test.yaml'))
  });

  after(function() { 
  	nodeCf.__set__('fileExists', fileExistsOrig);
  });
});

