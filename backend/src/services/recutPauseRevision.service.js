const { resolveSelection } = require('./recutSelectionValidation.service');
const { classifyRenderChecks } = require('./recutRenderChecks.service');

// Reuse the already reviewed words, cards and captions. Only derived clip
// references and time positions may change. The new version requires approval.
function buildPauseRevision(version, source, checks, renderer) {
  if (!source || !version?.plan || String(source.scriptId) !== String(version.scriptId) ||
      String(source._id) !== String(version.sourceId)) return null;
  const previous = resolveSelection(source, version.selection);
  const { plan } = version;
  const issues = classifyRenderChecks(checks, { ...plan.canvas, durationSec: previous.durationSec + plan.endCard.seconds }).issues;
  if (issues.length !== 1 || issues[0] !== 'silence') return null;
  const next = resolveSelection(source, version.selection, { allowInvalidDuration: true, cutLongPauses: true });
  if (next.durationSec >= previous.durationSec || next.durationSec < 30) return null;
  const built = renderer.buildRecutPlan({ source, selectionResult: next, scenes: plan.scenes, subtitles: plan.subtitles,
    title: plan.title, theme: plan.theme, endCard: plan.endCard, audio: plan.audio, modelId: version.modelId });
  if (built.errors.length || !renderer.validatePlan(built.plan, { sentences: source.sentences, evidence: source, resolved: built.resolved }).valid) return null;
  return { sourceId: version.sourceId, selection: next.selection, fullScript: next.fullScript,
    plan: built.plan, theme: plan.theme, modelId: version.modelId, shortRenderVersion: built.plan.versions.shortRender,
    assetVersions: built.plan.versions.assets };
}
module.exports = { buildPauseRevision };
