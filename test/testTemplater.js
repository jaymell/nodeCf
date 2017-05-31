var assert = require('assert');
const templater = require('../templater.js');

describe('render', function() {
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

  const nj = require('nunjucks');

  it('should successfully render jinja2-style parameters', () => {
    return templater.render(nj, templ, myVars)
      .then(d => assert.deepEqual(d, result));
  });
});

