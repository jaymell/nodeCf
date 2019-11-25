// schema to validate stacks
// defined in config files
// NOTE: this is validating individual stacks
// in the file, not the file itself:
const cfStackConfigSchema = {
  properties: {
    name: {
      type: "string",
      pattern: "^[a-zA-Z0-9\-]+$"
    },
    templateName: {
      type: "string",
      pattern: "^[a-zA-Z0-9\-/]+$"
    },
    lambdaArtifact: {
      type: "string"
    },
    tags: {
      type: "object",
      patternProperties: {
        "^[a-zA-Z0-9 ]+$": {
          type: "string"
        }
      },
      additionalProperties: false
    },
    parameters: {
      type: "object",
      patternProperties: {
        "^[a-zA-Z0-9]+$": {
          type: "string"
        }
      },
      additionalProperties: false
    },
    stackDependencies: {
      type: "array",
      items: {
        type: "string"
      }
    },
    creationTasks: {
      type: "array",
      items: {
        type: "string"
      }
    },
    preTasks: {
      type: "array",
      items: {
        type: "string"
      }
    },
    postTasks: {
      type: "array",
      items: {
        type: "string"
      }
    },
    timeout: {
      type: "number"
    },
    capabilities: {
      type: "array",
      items: {
        type: "string"
      }
    },
    stackDeployName: {
      type: "string"
    },
  },
  required: ["name"]
};

// schema to validate environment configuration
// (after it has any templating rendered)
const envConfigSchema = {
  properties: {
    application: {
      type: "string",
      pattern: "^[^-]+$"
    },
    account: {
      anyOf: [{
        type: "string"
      }, {
        type: "integer"
      }]
    },
    environment: {
      type: "string",
      pattern: "^[^-]+$"
    },
    infraBucket: {
      type: "string"
    },
    region: {
      type: "string"
    },
  },
  required: ["environment", "application", "infraBucket", "region"]
};

module.exports = {
  cfStackConfigSchema: cfStackConfigSchema,
  envConfigSchema: envConfigSchema
};
