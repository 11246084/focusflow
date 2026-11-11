const Source = require('../models/recutSource.model');
const { preview } = require('./recutReviewSelection.service');
async function renderSpecification(version) {
  const source = await Source.findById(version.sourceId).lean();
  if (!source) throw new Error('Frozen recut source is missing.');
  const canvas = version.plan?.canvas;
  if (canvas?.width !== 720 || canvas?.height !== 1280 || canvas?.fps !== 30) throw new Error('Unsupported approved render canvas.');
  const endCard = version.plan.endCard?.seconds ?? 0;
  if (!Number.isFinite(endCard) || endCard < 0) throw new Error('Invalid end card duration.');
  return { ...canvas, durationSec: preview(source, version.selection).durationSec + endCard };
}
module.exports = { renderSpecification };
