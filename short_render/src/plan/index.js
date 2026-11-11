'use strict';

const constants = require('./constants');
const components = require('./components');
const { validateStructure } = require('./schema');
const {
  validatePlan, compareCutText, collectDisplayTexts, safeEvaluate,
} = require('./validators');
const {
  locateAnchor, snapStart, snapEnd, resolvePlan,
} = require('./resolve');

module.exports = {
  ...require('./runtime'),
  ...require('./assets'),
  ...require('./catalog'),
  buildRecutPlan: require('./sentences').buildRecutPlan,
  getAllowedIcons: () => { const a = require('./assets').getAssetCatalog(); return [...a.fluent.map((v) => `fluent:${v}`), ...a.phosphor.map((v) => `phosphor:${v}`)]; },
  ...constants,
  ...components,
  validateStructure,
  validatePlan,
  compareCutText,
  collectDisplayTexts,
  safeEvaluate,
  locateAnchor,
  snapStart,
  snapEnd,
  resolvePlan,
};
