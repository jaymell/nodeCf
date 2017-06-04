const Promise = require('bluebird');
const _ = require('lodash');
const nunjucks = Promise.promisifyAll(require("nunjucks"));
const debug = require('debug')('templater');

function loadNjEnv(syncFilters, asyncFilters) {
  const env = new nunjucks.Environment();
  _.forEach(syncFilters, it => env.addFilter(it.name, it));
  _.forEach(asyncFilters, it => env.addFilter(it.name, it, true));
  return env;
}

// templ should be string;
// allows for referencing other variables within the template;
// recurse until there aren't any more values to be rendered:
async function render(nj, templ, templateVars) {
  debug('templ before: ', templ);
  // if no vars passed, use
  // template itself as source of variables:
  if (_.isUndefined(templateVars))
    templateVars = JSON.parse(_.cloneDeep(templ));

  templ = await nj.renderStringAsync(templ, templateVars);
  if (templ.match(/\{\{.*\}\}/)) {
    // recurse
    return await render(nj, templ, templateVars);
  }
  return templ;
}

// stringify, render and parse:
async function renderObj(nj, myVars, templateVars) {
  return JSON.parse(await render(nj, JSON.stringify(myVars), templateVars));
}

// helper function for safely rendering ( possibly
// undefined) list of strings:
async function renderList(nj, templList, templateVars) {
  const renderedList = await Promise.map(
    _.without(templList, _.isUndefined),
    async(it) => render(nj, it, templateVars));
  return renderedList;
}

module.exports = {
  loadNjEnv: loadNjEnv,
  render: render,
  renderList: renderList,
  renderObj: renderObj
};
