const Promise = require('bluebird');
const fs = Promise.promisifyAll(require('fs'));

// return filename if exists, else false
async function fileExists(f) {
  try {
    await fs.statAsync(f);
    return f;
  } catch (e) {
    throw e;
  }
}

module.exports = {
  fileExists: fileExists
};
