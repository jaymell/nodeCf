const assert = require('assert');
const rewire = require("rewire");
const nodeCf = rewire('../src/nodeCf.js');
const sinon = require('sinon');
const Promise = require('bluebird');

const getAwsCredentialsOrg = nodeCf.__get__('getAwsCredentials');

const testStackVarsWithRole = {
  name: 'testStack1',
  role: 'testStackRole',
  parameters: {},
  tags: {},
  stackDependencies: [],
  creationTasks: [],
  preTasks: [],
  postTasks: []
//  lambdaArtifact: {},
};

const testStackVarsNoRole = {
  name: 'testStack2',
  parameters: {},
  tags: {},
  stackDependencies: [],
  creationTasks: [],
  preTasks: [],
  postTasks: []
};

const testEnvVarsWithRole = {
  infraBucket: 'testBucket',
  environment: 'testEnvironment',
  application: 'testApplication',
  role: 'testEnvRole'
};

const testEnvVarsNoRole = {
  infraBucket: 'testBucket',
  environment: 'testEnvironment',
  application: 'testApplication'
};

describe('roles', () => {
  before(() => {
    nodeCf.__set__('getAwsCredentials', role => Promise.resolve(role));
  });

  it('when stack has role and env does not, should use stack role', () => {
    const stack = new nodeCf.CfStack(testStackVarsWithRole,
      testEnvVarsNoRole, {}, {});
    return stack.getAwsCredentials()
      .then(d => assert.equal(d, 'testStackRole'));
  });

  it('when stack and env have role, should use stack role', () => {
    const stack = new nodeCf.CfStack(testStackVarsWithRole,
      testEnvVarsWithRole, {}, {});
    return stack.getAwsCredentials()
      .then(d => assert.equal(d, 'testStackRole'));
  });

  it('when stack no role but env does, should use env role', () => {
    const stack = new nodeCf.CfStack(testStackVarsNoRole,
      testEnvVarsWithRole, {}, {});
    return stack.getAwsCredentials()
      .then(d => assert.equal(d, 'testEnvRole'));
  });


  it('when stack and env have no role, role should be undefined', () => {
    const stack = new nodeCf.CfStack(testStackVarsNoRole,
      testEnvVarsNoRole, {}, {});
    return stack.getAwsCredentials()
      .then(d => assert.equal(d, undefined));
  });

  after(() => nodeCf.__set__('getAwsCredentials', getAwsCredentialsOrg));

});
