var assert = require('assert');
var config = require('../config.js');
var rewire = require("rewire");
var nodeCf = rewire('../nodeCf.js');

const wrapWith = nodeCf.__get__('wrapWith');

describe('successful tests', function() {

  it('input key/value pairs should return wrapped array', function() {
    const output = [
      {"ParameterKey": "Key1", "ParameterValue": "Value1"},
      {"ParameterKey": "Key2", "ParameterValue": "Value2"},
    ];

    const input = {
      Key1: "Value1", 
      Key2: "Value2"  
    };

    const result = wrapWith('ParameterKey', 'ParameterValue', input);

    assert.deepEqual(result, output);

  });
});

