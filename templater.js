const Promise = require('bluebird');
const _ = require('lodash');
const nunjucks = Promise.promisifyAll(require("nunjucks"));

function loadNjEnv(syncFilters, asyncFilters) {
  const env = new nunjucks.Environment();
  _.chain(syncFilters)
    .remove(_.isUndefined)
    .forEach(it => env.addFilter(it.name, it));
  _.chain(asyncFilters)
    .remove(_.isUndefined)
    .forEach(it => env.addFilter(it.name, it, true))
  return env;
}

// allows for referencing other variables within the config;
// recurse until there aren't any more values to be rendered:
async function render(nj, myVars, templateVars) {
  if (typeof templateVars === 'undefined') {
    // use variables as inputs
    // for their own rendering
    templateVars = JSON.parse(JSON.stringify(myVars));
  }
  var myVars = await nj.renderStringAsync(JSON.stringify(myVars), templateVars);
  myVars = JSON.parse(myVars);
  _.forOwn(myVars, async function(v, k) {
    if (typeof v === "string" && v.includes('{{') && v.includes('}}'))
      myVars = await render(nj, myVars, templateVars);
  });
  return myVars;
}

module.exports = {
  loadNjEnv: loadNjEnv,
  render: render
}
