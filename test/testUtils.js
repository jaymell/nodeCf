const Promise = require('bluebird');
const utils = require('../src/utils.js');
const assert = require('assert');
const _ = require('lodash');

describe('execTask', () => {
  it('stdout should match', () => {
    return utils.execTask('echo Testing123')
      .then(it => assert.equal(it.stdout, "Testing123\n"));
  });
});

describe('execTasks', () => {
  it('execTasks should successfully execute working tasks', () => {
    return utils.execTasks(["ls", "echo"]);
  });
  it('stdout should match', () => {
    return utils.execTasks(['echo Test1', 'echo Test2', 'echo Test3'])
      .then(it => assert.deepEqual(_.map(it, 'stdout'),
        ["Test1\n", "Test2\n", "Test3\n"]));
  });
  it('execTasks should throw exception for non-zero commands', () => {
    return utils.execTasks(["ls nonExistentFile", "nonExistentCommand"])
      .then(() => new Error('unexpected resolve'))
      .catch(e => {
        if (e.message === 'unexpected resolve') {
          throw e;
        }
      });
  });
});
