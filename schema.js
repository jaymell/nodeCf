// schema to validate stacks
// defined in config files
const cfStackConfigSchema = {
  properties: {
    name: {
      type: "string",
      pattern: "^[a-zA-Z0-9\-]+$"
    },
    tags: {
      type: "array",
      items: {
        type: "object",
        patternProperties: {
          "^[a-zA-Z0-9]+$": {
            type: "string"
          }
        },
        additionalProperties: false
      },
      additionalItems: false
    },
    parameters: {
      type: "array",
      items: {
        type: "object",
        patternProperties: {
          "^[a-zA-Z0-9]+$": {
            type: "string"
          }
        },
        additionalProperties: false
      },
      additionalItems: false
    },
    deps: {
      type: "array",
      items: {
        type: "string"
      }
    }
  },
  required: ["name"]
};

// schema to validate environment configuration
// (after it has any templating rendered)
const envConfigSchema = {
  properties: {
    application: {
      type: "string"
    },
    account: {
      anyOf: [{
        type: "string",
        pattern: "^[0-9]+$"
      }, {
        type: "integer"
      }]
    },
    environment: {
      type: "string"
    },
    infraBucket: {
      type: "string"
    },
    region: {
      type: "string"
    },
  },
  required: ["account", "environment", "application", "infraBucket", "region"]
};

module.exports = {
  cfStackConfigSchema: cfStackConfigSchema,
  envConfigSchema: envConfigSchema
};
