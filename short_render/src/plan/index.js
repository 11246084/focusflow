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
