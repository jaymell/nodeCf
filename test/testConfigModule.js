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
    assert.throws(() => config.filterStacks(mockStacks, ['test1', 'test2', 'test3', 'test4']));
  });

  it('should return stack specified', function() {
    assert.deepEqual(config.filterStacks(mockStacks, ['test1']), mockStacksResp);
  });

  it('should return stacks if no filters passed', function() {
    assert.deepEqual(config.filterStacks(mockStacks, []), mockStacks.stacks);
  });
});

describe('parseExtraVars', () => {
  it('should return object of key-value pairs when given the right input', () => {
    const input = "key1=value1 key2=value2 key3=value3";
    const output = { key1: 'value1', key2: 'value2', key3: 'value3' };
    assert.deepEqual(config.parseExtraVars(input), output);
  });
  
  it('should throw when a key with no = or value is passed', () => {
    const input = "key1=value1 key2=value2 key3=value3 key4";
    assert.throws(() => config.parseExtraVars(input), /Can\'t parse variable/)
  });

  it('should returned undefined if undefined is passed', () => {
    assert.equal(config.parseExtraVars(undefined), undefined);
  });

});