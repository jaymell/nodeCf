const assert = require('assert');
const rewire = require("rewire");
const config = rewire('../src/config.js');
const templater = rewire('../src/templater.js');
const utils = require('../src/utils.js');
const sinon = require('sinon');
const fs = require('fs');
const yaml = require('js-yaml');
const isValidJsonSchemaOrg = config.__get__('isValidJsonSchema');
const loadStackYamlOrg = config.__get__('loadStackYaml');

describe('filterStacks', () => {
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

  it('should throw if stackFilters contains a non-existent stack name', () => {
    assert.throws(() => config.filterStacks(mockStacks,
      ['test1', 'test2', 'test3', 'test4']));
  });

  it('should return stack specified', function() {
    assert.deepEqual(config.filterStacks(mockStacks,
      ['test1']), mockStacksResp);
  });

  it('should return stacks if no filters passed', function() {
    assert.deepEqual(config.filterStacks(mockStacks, []), mockStacks.stacks);
  });
});

describe('parseExtraVars', () => {
  it('should return object of key-value pairs', () => {
    const input = "key1=value1 key2=value2 key3=value3";
    const output = { key1: 'value1', key2: 'value2', key3: 'value3' };
    assert.deepEqual(config.parseExtraVars(input), output);
  });

  it('should throw when a key with no = or value is passed', () => {
    const input = "key1=value1 key2=value2 key3=value3 key4";
    assert.throws(() =>
      config.parseExtraVars(input), /Can\'t parse variable/);
  });

  it('should returned undefined if undefined is passed', () => {
    assert.equal(config.parseExtraVars(undefined), undefined);
  });
});

describe('loadNodeCfConfig', () => {
  it('should return what\'s passed', () => {
    const nodeCfCfg = config.loadNodeCfConfig(
      {localCfTemplateDir: 'someTestDir'});
    assert.equal(nodeCfCfg.localCfTemplateDir, 'someTestDir');
  });

  it('should return proper paths under localCfgDir', () => {
    const nodeCfCfg = config.loadNodeCfConfig(
      {localCfgDir: 'someTestDir'});
    assert.equal(nodeCfCfg.globalCfg, 'someTestDir/global.yml');
  });

  it('should return defaults if nothing passed', () => {
    const nodeCfCfg = config.loadNodeCfConfig();
    assert.equal(nodeCfCfg.localCfTemplateDir, './templates');
    assert.equal(nodeCfCfg.stackDefaults. tags.environment, '{{environment}}');
  });
});

describe('parseArgs', () => {
  it('should return undefined if no stacks passed', () => {
    const myArgs = { _: [], environment: 'Dev', region: 'us-east-1' };
    const retVal = config.parseArgs(myArgs);
    assert.equal(retVal.stackFilters, undefined);
  });

  it('should return names of stacks passed', () => {
    const myArgs = { _: [], e: 'Dev', region: 'us-east-1',
      stacks: 'stack1,stack2' };
    const retVal = config.parseArgs(myArgs);
    assert.equal(retVal.stackFilters, 'stack1,stack2');
  });

  it('should throw if no env passed', () => {
    const myArgs = { _: [], region: 'us-east-1' };
    assert.throws(() => config.parseArgs(myArgs), /No environment passed/);
  });

  it('should throw if empty env passed', () => {
    const myArgs = { _: [], environment: true, region: 'us-east-1' };
    assert.throws(() => config.parseArgs(myArgs), /No environment passed/);
  });

  it('should throw if empty env passed', () => {
    const myArgs = { _: [], e: true, region: 'us-east-1' };
    assert.throws(() => config.parseArgs(myArgs), /No environment passed/);
  });
});

describe('loadEnvConfig', () => {
  before(() => config.__set__('isValidJsonSchema', () => true));
  it('should override previous vars with subsequent ones', () => {
    const nj = templater.loadNjEnv();
    return config.loadEnvConfig(nj, {}, {testVar1: 1}, {testVar1: 2})
      .then(d => assert.deepEqual(d.testVar1, 2));
  });
  after(() => config.__set__('isValidJsonSchema', isValidJsonSchemaOrg));
});

describe('loadEnvFile', () => {
  before(() => {
    sinon.stub(utils, 'fileExists').callsFake(f => Promise.resolve(f));
    sinon.stub(yaml, 'safeLoad').callsFake(f => ({test: 'data'}));
    sinon.stub(fs, 'readFileAsync').callsFake(f => Promise.resolve());
  });
  it('should return data if file exists', () =>
    config.loadEnvFile('testDir', 'testEnv')
      .then(it => assert.deepEqual(it, {test: 'data'})));
  after(() => {
    utils.fileExists.restore();
    yaml.safeLoad.restore();
    fs.readFileAsync.restore();
  });
});

describe('loadEnvFile', () => {
  before(() => {
    sinon.stub(utils, 'fileExists').callsFake(f => Promise.resolve(false));
    sinon.stub(yaml, 'safeLoad').callsFake(f => ({test: 'data'}));
    sinon.stub(fs, 'readFileAsync').callsFake(f => Promise.resolve());
  });
  it('should return undefined if no file found', () =>
    config.loadEnvFile('testDir', 'testEnv')
      .then(it => assert.equal(it, undefined)));
  after(() => {
    utils.fileExists.restore();
    yaml.safeLoad.restore();
    fs.readFileAsync.restore();
  });
});

describe('loadStacks', () => {
  before(() => {
    config.__set__({
      isValidJsonSchema: () => true,
      loadStackYaml: () => []
    });
  });
  it('should throw if empty object passed', () => {
    return config.loadStacks({}, [], {}, {})
      .then(() => new Error('unexpected resolve'))
      .catch(e => {
        if (e.message !== 'invalid stack argument') {
          throw e;
        }
    });
  });
  after(() => config.__set__({
    isValidJsonSchema: isValidJsonSchemaOrg,
    loadStackYaml: loadStackYamlOrg
  }));
});

describe('loadStacks', () => {
  // should match config.loadNodeCfConfig
  const stackDefaults = {
    capabilities: [ 'CAPABILITY_IAM', 'CAPABILITY_NAMED_IAM' ],
    timeout: 45,
    tags: {
      environment: "testEnv",
      application: "{{application}}"
    }
  };

  it('should return defaults if nothing else specified', () => {
    const testStack = { name: 'testStack' };
    config.__set__({
      isValidJsonSchema: () => true,
      loadStackYaml: () => [ testStack ]
    });
    return config.loadStacks({}, [], {}, stackDefaults)
      .then(it => {
        assert.deepEqual(it[0].tags, stackDefaults.tags);
        assert.deepEqual(it[0].timeout, stackDefaults.timeout);
        assert.deepEqual(it[0].capabilities, stackDefaults.capabilities);
      })
      .then(() => config.__set__({
        isValidJsonSchema: isValidJsonSchemaOrg,
        loadStackYaml: loadStackYamlOrg
      }));
  });

  it('stack params should override defaults', () => {
    const testStack = { name: 'testStack',
      tags: { one: 1, two: 2 },
      capabilities: [ "TEST_CAPABILITY"],
      timeout: 667
    };
    config.__set__({
      isValidJsonSchema: () => true,
      loadStackYaml: () => [ testStack ]
    });
    return config.loadStacks({}, [], {}, stackDefaults)
      .then(it => {
        assert.deepEqual(it[0].tags, testStack.tags);
        assert.deepEqual(it[0].timeout, testStack.timeout);
        assert.deepEqual(it[0].capabilities, testStack.capabilities);
      })
      .then(() => config.__set__({
        isValidJsonSchema: isValidJsonSchemaOrg,
        loadStackYaml: loadStackYamlOrg
      }));
  });
});

describe('loadYaml', () => {
  /* eslint-disable */
  it('should replace null values with templateable variable with same name as key', () => {
    const mockFile = JSON.stringify(
      { testAlreadyDefined: "alreadyDefined",
        testNullShouldBeReplacedWithTemplatableValue: null,
        testBlankButNotNull: "",
        testNestedArray: [
          { testNestedNullShouldBeReplacedWithTemplatableValue: null },
          { testNestedAlreadyDefined: "alreadyDefined" },
          { testNestedBlankButNotNull: "" }
        ]
      });
    const out = config.loadYaml(mockFile);
    assert.deepEqual(
      { testAlreadyDefined: "alreadyDefined",
        testNullShouldBeReplacedWithTemplatableValue: "{{testNullShouldBeReplacedWithTemplatableValue}}",
        testBlankButNotNull: "",
        testNestedArray: [
          { testNestedNullShouldBeReplacedWithTemplatableValue: "{{testNestedNullShouldBeReplacedWithTemplatableValue}}" },
          { testNestedAlreadyDefined: "alreadyDefined" },
          { testNestedBlankButNotNull: "" }
        ]
      }, out);
  });
});


describe('parseStringArrays', () => {
  const expected = ["testStack1", "testStack2", "testStack3"];
  it("should return expected array given command-delimited string", () => {
    assert.deepEqual(expected, config.parseStringArrays("testStack1,testStack2,testStack3"));
  });
  it("should return expected array given command-delimited string w/ extra spaces", () => {
    assert.deepEqual(expected, config.parseStringArrays("testStack1 , testStack2 , testStack3"));
  });
  it("should throw if string not passed", () => {
    let badStacks = ["testStack1", "testStack2"];
    assert.throws(() => config.parseStringArrays(badStacks),
      new RegExp(`Error: ${badStacks.toString()} is not a string`));
  })
});
  /* eslint-enable */
