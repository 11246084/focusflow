// Decision 62: fixed thresholds shared by real-worker checks and backend evidence validation.
const LIMITS = Object.freeze({ durationToleranceSec: 0.5, blackMaxSec: 0.5, silenceMaxSec: 2,
  silenceNoiseDb: -50, blackPixelThreshold: 0.05, targetLufs: -16, lufsTolerance: 2, maxTruePeakDbtp: -1.5 });
function classifyRenderChecks(checks, expected = {}) {
  const fixed = [], intermittent = [];
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  if (!checks || typeof checks !== 'object' || Array.isArray(checks)) return { valid: false, retryable: false, issues: ['missing_checks'] };
  if (checks.videoTracks !== 1 || checks.audioTracks !== 1 || checks.width !== expected.width || checks.height !== expected.height
    || checks.fps !== expected.fps || !finite(checks.durationSec) || !finite(expected.durationSec)
    || Math.abs(checks.durationSec - expected.durationSec) > LIMITS.durationToleranceSec) fixed.push('tracks_or_specification');
  if (!finite(checks.blackMaxSec) || checks.blackMaxSec >= LIMITS.blackMaxSec) intermittent.push('black_frames');
  if (checks.fontLoaded !== true) intermittent.push('font_not_loaded');
  if (!finite(checks.silenceMaxSec) || checks.silenceMaxSec >= LIMITS.silenceMaxSec) fixed.push('silence');
  if (!finite(checks.integratedLufs) || Math.abs(checks.integratedLufs - LIMITS.targetLufs) > LIMITS.lufsTolerance
    || !finite(checks.truePeakDbtp) || checks.truePeakDbtp > LIMITS.maxTruePeakDbtp) fixed.push('loudness');
  return { valid: !fixed.length && !intermittent.length, retryable: !fixed.length && Boolean(intermittent.length), issues: [...fixed, ...intermittent] };
}
module.exports = { LIMITS, classifyRenderChecks };
