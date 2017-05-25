var assert = require('assert');
var config = require('../config.js');

describe('filterStacks', function() {
  const mockStacks = { 
    stacks: 
    [ { name: 'test1', parameters: [] },
      { name: 'test2', parameters: [] },
      { name: 'test3', parameters: [] },
      ] 
  };

  const mockStacksResp = [ 
      { name: 'test1', parameters: [] } 
  ];

  it('should throw if stackFilters contains a non-existent stack name', function() {
    assert.throws(() => config.filterStacks(mockStacks, ['test1', 'test2', 'test3', 'test4'])

    );
  });

  it('should return stack specified', function() {
    assert.deepEqual(config.filterStacks(mockStacks, ['test1']), mockStacksResp);
  });

  it('should return stacks if no filters passed', function() {
    assert.deepEqual(config.filterStacks(mockStacks, []), mockStacks.stacks);
  });
});

describe('renderConfig', function() {
  const templ = {
    testKey1: "{{templ1}}",
    testKey2:  "{{templ2.value}}"
  };
  const myVars = {
    templ1: "testValue1",
    templ2: {
      value: "testValue2"
    }
  };
  const result = {
    testKey1: 'testValue1',
    testKey2: 'testValue2'
  }

  it('should successfully render jinja2-style parameters', () => {
    assert.deepEqual(config.renderConfig(templ, myVars), result);
  });
});

