const assert = require('assert');
const rewire = require("rewire");
const run = rewire('../src/run.js');
const _ = require('lodash');

const loadStacksOrg = run.__get__('loadStacks');

async function mockLoadStacks(stackCfg, stackFilters, schema, stackDefaults) {
  const stacks = [{ name: "infra", parameters: { "VpcId": "{{VpcId}}"}}];
  return _.chain(stacks)
      // assign default stack params
      .map(stack => _.assign({}, stackDefaults, stack)).value();
}

describe('loadEnvironment', () => {
  before(() => run.__set__({ loadStacks: mockLoadStacks }));
  it('should return expected output', async() => {
    const { action,
            stacks,
            envVars,
            nj,
            nodeCfCfg } =  await run.loadEnvironment(["-e", "Dev",
                                "-r", "us-east-1",
                                "-x", "application=test infraBucket=test"]);
    assert.equal(action, "deploy");
    /* eslint-disable */

    assert.deepEqual(stacks, [{"capabilities":["CAPABILITY_IAM","CAPABILITY_NAMED_IAM"],"timeout":45,"tags":{"environment":"{{environment}}","application":"{{application}}"},"name":"infra","parameters":{"VpcId":"{{VpcId}}"}}]);
    assert.deepEqual(nodeCfCfg, {"localCfTemplateDir":"./templates","localCfgDir":"./config","filters":"./config/filters.js","s3CfTemplateDir":"nodeCf/templates","s3LambdaDir":"nodeCf/lambda","globalCfg":"./config/global.yml","stackCfg":"./config/stacks.yml","deleteUploadedTemplates":true,"stackDefaults":{"capabilities":["CAPABILITY_IAM","CAPABILITY_NAMED_IAM"],"timeout":45,"tags":{"environment":"{{environment}}","application":"{{application}}"}}});
    /* eslint-enable */
  });
  after(() => run.__set__({ loadStacks: loadStacksOrg }));
});

