## Overview
Simple package to help with Cloudformation deployments. It is written in nodejs, but the goal here is that you do not have to write any code to use it.

### Goals
* Make it easy to deploy multi-stack, multi-account, multi-environment, and multi-region Cloudformation templates
* Promote use of 'native' Cloudformation templates (i.e., with minimal pre-processing)

### Installation
Requires:
* nodejs v8.0.0 or later
* npm

```
npm i --save nodecf
```

### Usage
```
node_modules/.bin/nodeCf [ ACTION ] -e,--environment <ENVIRONMENT> [ -r <REGION> ]  [-s,--stacks <STACK NAMES>] [ -p <PROFILE> ] [ -x, --extra-vars <EXTRA VARS> ]
```

Run deployment against specified ENVIRONMENT.

* ENVIRONMENT must be defined and passed at run-time
* ACTION defaults to 'deploy': choices are 'deploy', 'delete', and 'validate'
* REGION specifies the desired AWS Region
* PROFILE specifies an optional name for an AWS profile to assume when running the job
* STACK NAME corresponds to the name of your Cloudformation templates, separated by commas if multiple
* EXTRA VARS indicate extra variables for deployment; useful for any variables that are only known at runtime; in the form "KEY=VALUE" -- additional variables should be separated by spaces

### Template Files
Cloudformation templates -- by default are stored in `./templates` in either json or yaml format.

By default, the template name should match the unqualified name of the stack -- e.g., a stack named 'service' should have a corresponding file named `service`, `service.yml`,  `service.yaml`, or `service.json` in the templates folder. You can override this, however, by passing a `templateName` property on the stack object.

Example:
```
- name: network
  templateName: mynetwork
  parameters:
    VpcIPRange: "{{VpcIPRange}}"
```

### Configuration
Configuration parameters are rendered with the following order of precedence, with highest precedence listed first:
* "Extra vars" passed on the command line
* System environment variables
* Environment-specific config file
* Global config file

Config files must be written in yaml and by default are looked for in `./config`
* Environment Config File (Optional): Stores environment-specific variables  -- e.g., `./config/dev.yml`
* Global config file (Optional): Stores variables common to all environments -- e,g, `./config/global.yml`
* Stack configuration (Required) -- Defines parameters and tags to pass to Cloudformation, as well as pre-and post-tasks (see below for more info)
* NodeCf configuration (Optional) -- This feature doesn't actually exist yet, but should allow for overriding variables that get set in the `config` module

### Required variables:
* environment -- this must be passed on command line
* stacks -- these must either be passed on command line or defined in your environments file(s) or system environment variables; it is an array of stacks which must be run -- order matters
* region -- this defines the aws region to which you're deploying
* account -- your AWS account number
* application -- this can be anything, but the name of your repository is a good default; it is used for naming and uniquely identifying resources
* infraBucket -- Cloudformation stacks over a certain size must first be uploaded to s3; as a result, nodeCf requires the name of a bucket to use for deployments; the scripts will handle creating it for you (assuming its name has not already been taken by some other random AWS user).

Example stacks.yml:
```
---
stacks:
- name: network
  parameters:
    VpcIPRange: "{{VpcIPRange}}"
    PrivateSubnet0: "{{PrivateSubnet0}}"
    PrivateSubnet1: "{{PrivateSubnet1}}"
- name: rds
  parameters:
    NetworkStack: "{{environment}}-{{application}}-network"
    PrivateSubnet0: "{{PrivateSubnet0}}"
    PrivateSubnet1: "{{PrivateSubnet1}}"
```

Example env.yml:
```
---
account: "{{accounts.production}}"
infraBucket: myUniqueBucketname # required -- nodeCf will attempt to create it if it doesn't exist
VpcIPRange: 10.0.0.0/8
PrivateSubnet0Cidr: 10.0.0.0/24
PrivateSubnet1Cidr: 10.0.1.0/24
```

Example global.yml:
```
---
application: MyApplication
accounts:
  production: <MY AWS Account number -- e.g., 123456789012>
```

### Filters
You can also use your own filters, which are custom node functions that allow you to modify variables or perform arbitrary actions; by default, place them in `./config/filters.js`. Export them as you would in any other nodejs module, e.g.:
```
module.exports = {
  sync: {
    mySyncFunction: mySyncFunction,
  },
  async: {
    myAsyncFunction: myAsyncFunction
  }
};
```

You could then pass your variable through a filter like this:
```
{{ myVariable | filterName }}
```

If the filter function is asynchronous, you must indicate so by wrapping it in an `async` key in modules.exports. You can read more about filters in the [Nunjucks documentation](https://mozilla.github.io/nunjucks/templating.html#filters).

### Outputs, Pre-Tasks, Post-Tasks, Creation Tasks, and Lambda Artifacts
There are a few additional properties you can add to the individual stack definitions to help with deployments.

#### Stack Ouptuts
If you have a multi-stack project, you often need to reference outputs from one stack as inputs to another. You can do this via cross-stack references, but cross-stack references not only tightly couple your stacks together, they also can't be leveraged in certain scenarios. An alternative approach is to use NodeCf to do the integration for you:

```
stacks:
- name: network
  parameters:
    VpcIPRange: "{{VpcIPRange}}"
- name: rds
  parameters:
    PrivateSubnet0: "{{stacks.network.outputs.PrivateSubnet0}}"
    PrivateSubnet1: "{{stacks.network.outputs.PrivateSubnet1}}"
  stackDependencies:
  - "{{environment}}-{{application}}-network"
```

In order to use the outputs from the network stack in the rds stack, declare the dependency on the fully-qualified name of the network stack in `stackDependencies`, then reference the name of the output variable as `stacks.outputs.<Variable Name>`.

If you need to use stack outputs of the _current_ stack (e.g., if you want to use the outputs of the stack you just deployed in a post-task), it will not be stored in `stacks` object, you should instead reference the `outputs` object directly:

```
stacks:
- name: network
  parameters:
    VpcIPRange: "{{VpcIPRange}}"
  postTasks:
  - echo "{{outputs.PrivateSubnet0}}" # echo the stack's PrivateSubnet0 output to the console
```

#### Pre-Tasks, Post-Tasks and Creation Tasks
If you consistently need to run an arbitrary shell script or command immediately prior to or after deploying a CF template, you can add it under `preTasks` or `postTasks`, which consists of an array of shell-interpreted strings. If you only need to run a script when a stack is first created, you can call it under `creationTasks`. For example:

```
stacks:
- name: network
  parameters:
    VpcIPRange: "{{VpcIPRange}}"
    PrivateSubnet0: "{{PrivateSubnet0}}"
    PrivateSubnet1: "{{PrivateSubnet1}}"
  creationTasks:
  - "./scripts/doThisOnlyWhenStackFirstCreated.js"
  preTasks:
  - "./scripts/preTask1.sh"
  - "./scripts/preTask2.sh"
  postTasks:
  - "./scripts/peerToSharedVpc.sh"
```

Note that you're not limited to shell scripts -- these can be any scripts in any language, provided the system deploying the stacks has the proper tools installed.

#### Lambda Artifacts
Deploying Lambda functions via Cloudformation can be a pain.
1. The code must be built and packaged (which is _not_ handled here) or if not a compiled language, embedded directly within the Cloudformation template
2. uploaded to s3 with a unique name (if the name of the artifact doesn't change with subsequent deployments, your code won't be updated)
3. the location in s3 must be passed to the actual CF template in which the Lambda function is defined.

NodeCf offers a few helpers to make these steps a bit easier.

Assuming you've built and packaged your lambda function into an artifact, e.g., a zip file, you can specify the path to it under a `lambdaArtifact` property, then reference its location with `{{lambda.bucket}}` and `{{lambda.key}}`. NodeCf will handle uploading it to s3 with a unique name.

For example:
```
stacks:
- name: myLambdaStack
  lambdaArtifact: ./lambda/dist/myLambda.zip
  parameters:
    LambdaBucket: "{{lambda.bucket}}"
    LambdaKey: "{{lambda.key}}"
```

### Credentials
In addition to being able to use an AWS credentials profile, NodeCf can handle deployment via role assumption. Roles can be defined by specifying the ARN of the role to assume in one of two places:

* at the 'environment' level
Define a variable called 'role' on the command line or in your environment-specific or global config file.

* on a per-stack basis
You can assume a role on a per-stack basis by adding a 'role' parameter to a stack object, for example:

```
- name: network
  templateName: mynetwork
  role: "arn:aws:iam::{{myAwsAccountNumber}}:role/myRole"
  parameters:
    VpcIPRange: "{{VpcIPRange}}"
```
