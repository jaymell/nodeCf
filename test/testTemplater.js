const assert = require('assert');
const templater = require('../templater.js');

describe('render', () => {
  const myVars = {
    testKey1: "{{templ1}}",
    testKey2:  "{{templ2.value}}",
    testKey3: "{{templ3}}"
  };
  const templateVars = {
    templ1: "testValue1",
    templ2: {
      value: "testValue2"
    },
    templ3: "{{templ1}}"
  };
  const result = {
    testKey1: 'testValue1',
    testKey2: 'testValue2',
    testKey3: 'testValue1'
  };

  const nj = require('nunjucks');

  it('should successfully render jinja2-style parameters recursively',
    () => templater.renderObj(nj, myVars, templateVars)
      .then(it => {
        return assert.deepEqual(it, result);
      }));
});

describe('renderList', () => {
  const nj = require('nunjucks');
  const templateVars = {
    test1: "test",
    test2: "TEST"
  };
  const input = [
    "this is a {{test1}}",
    "this is only a {{test2}}"
  ];
  const output = [
    "this is a test",
    "this is only a TEST"
  ];
  it('should return a list of rendered strings', () => {
    return templater.renderList(nj, input, templateVars)
      .then(it => assert.deepEqual(it, output));
  });
});