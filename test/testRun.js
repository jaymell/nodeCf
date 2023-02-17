const assert = require('assert');
const rewire = require("rewire");
const run = rewire('../src/run.js');
const _ = require('lodash');

const loadStacksOrg = run.__get__('loadStacks');
const loadStackGroupsOrg = run.__get__('loadStackGroups');

async function mockAlwaysError() {
  throw new Error("This mock shouldn't have been invoked");
}

async function mockLoadStacks(stackCfg, stackFilters, schema, stackDefaults) {
  const stacks = [{ name: "infra", parameters: { "VpcId": "{{VpcId}}"}}];
  return _.chain(stacks)
      // assign default stack params
      .map(stack => _.assign({}, stackDefaults, stack)).value();
}

async function mockLoadStackGroups(stackCfg, stackGroups, schema, stackDefaults) {
  const stacks = [
    { name: "ecsTaskRole", parameters: { "VpcId": "{{VpcId}}" } },
    { name: "ecs0", foo: "bar" },
    { name: "ecs1", lorem: "ipsum" },
  ];
  return [
    { name: "group1", stacks: [stacks[0], stacks[1]] },
    { name: "group2", stacks: [stacks[2]] },
  ];
}

describe('loadEnvironment', () => {
  before(() => run.__set__({ loadStacks: mockLoadStacks, loadStackGroups: mockAlwaysError }));
  it('should return expected output', async() => {
    const { action,
      stackGroups,
      envVars,
      nj,
      nodeCfCfg
    } =  await run.loadEnvironment([
      "-e", "Dev",
      "-r", "us-east-1",
      "-x", "application=test infraBucket=test",
    ]);
    assert.equal(action, "deploy");
    /* eslint-disable */

    assert.deepEqual(stackGroups, [{"name":"infra","stacks":[{"capabilities":["CAPABILITY_IAM","CAPABILITY_NAMED_IAM"],"timeout":45,"tags":{"environment":"{{environment}}","application":"{{application}}"},"name":"infra","parameters":{"VpcId":"{{VpcId}}"}}]}]);
    assert.deepEqual(nodeCfCfg, {"localCfTemplateDir":"./templates","localCfgDir":"./config","filters":"./config/filters.js","s3CfTemplateDir":"nodeCf/templates","s3LambdaDir":"nodeCf/lambda","globalCfg":"./config/global.yml","stackCfg":"./config/stacks.yml","deleteUploadedTemplates":true,"stackDefaults":{"capabilities":["CAPABILITY_IAM","CAPABILITY_NAMED_IAM"],"timeout":45,"tags":{"environment":"{{environment}}","application":"{{application}}"}}});
    /* eslint-enable */
  });
  after(() => run.__set__({ loadStacks: loadStacksOrg, loadStackGroups: loadStackGroupsOrg }));
});
