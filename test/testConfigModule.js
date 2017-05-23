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
