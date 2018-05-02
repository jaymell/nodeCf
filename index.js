#!/usr/bin/env node

const run = require('./src/run.js');

async function main() {
  const { action,
          stacks,
          envVars,
          nj,
          nodeCfCfg } = await run.loadEnvironment(process.argv.slice(2));
  run.run(action, stacks, envVars, nj, nodeCfCfg);
}

main();

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason);
  process.exit(1);
});
