const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));
const debug = require('debug')('utils');
const child_process = require('child_process');
const _ = require('lodash');

// return filename if exists, else throw
async function fileExists(f) {
  debug(`fileExists called with: ${JSON.stringify(arguments)}`);
  try {
    await fs.statAsync(f);
    return f;
  } catch (e) {
    throw e;
  }
}

async function execTask(task) {
  return new Promise((res, rej) =>
    child_process.exec(task, (err, stdout, stderr) => {
      if (err) {
	console.log(stdout, stderr);
	return rej(err);
      }
      return res({stdout: stdout, stderr: stderr });
    }));
}

// exec list of tasks, print stdout and stderr for each
async function execTasks(tasks, taskType) {
  debug(`execTasks: called for ${taskType}`);
  if (!(_.isEmpty(tasks))) {
    if (taskType) console.log(`running ${taskType}...`);
    const output = await Promise.mapSeries(tasks, async(task) => {
      const result = await execTask(task);
      if (_.isString(result.stdout) && (!_.isEmpty(result.stdout)))
        console.log(result.stdout.trim());
      if (_.isString(result.stderr) && (!_.isEmpty(result.stderr)))
        console.log(result.stderr.trim());
      return result;
    });
    return output;
  }
  debug("execTasks: nothing to do; resolving");
  return;
}

module.exports = {
  fileExists: fileExists,
  execTask: execTask,
  execTasks: execTasks
};
