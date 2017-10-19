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

