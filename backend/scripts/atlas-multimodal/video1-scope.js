// Fixed acceptance scope. A manifest hash is approved explicitly, never inferred from its contents.
const fs = require('node:fs');
const crypto = require('node:crypto');
const VIDEO_ID = '6a6da68e56dd124511ec51b4';
const COURSE_ID = '6a6da68456dd124511ec5196';
const CORPUS = require('./corpus.json');
function specification(videoId) { return CORPUS.videos.find(v => v.videoId === videoId); }
function expectedKinds(scope, id) { return specification(scope?.videoId)?.skipMediaIds.includes(id) ? ['text'] : ['text', 'audio', 'visual']; }
function expectedRecords(scope) { return scope.ids.reduce((n, id) => n + expectedKinds(scope, id).length, 0); }
const IDS = Array.from({ length: 117 }, (_, i) => `${VIDEO_ID}_chunk_${String(i + 1).padStart(4, '0')}`);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function validateScope(scope) {
  if (scope?.schemaVersion === 'video_manifest_v1') {
    const spec = specification(scope.videoId);
    const ids = spec && Array.from({ length: spec.count }, (_, i) => `${spec.videoId}_chunk_${String(i + 1).padStart(4, '0')}`);
    if (!spec || spec.key === 'V1' || scope.courseId !== COURSE_ID || scope.sourceSha256 !== spec.sourceSha256
      || scope.artifactSha256 !== spec.artifactSha256 || scope.durationSec !== spec.durationSec
      || JSON.stringify(scope.ids) !== JSON.stringify(ids) || scope.chunks?.length !== spec.count
      || new Set(scope.chunks.map(c => c.chunkId)).size !== spec.count
      || scope.chunks.some(c => !ids.includes(c.chunkId) || c.videoId !== spec.videoId || c.courseId !== COURSE_ID
        || typeof c.text !== 'string' || !c.text.trim() || !Number.isFinite(c.startSec) || !Number.isFinite(c.endSec)
        || c.startSec < 0 || c.endSec <= c.startSec || c.endSec > spec.durationSec
        || (c.endSec - c.startSec > 60) !== spec.skipMediaIds.includes(c.chunkId)
        || (spec.skipMediaIds.includes(c.chunkId) && (Object.keys(c.media || {}).length !== 0 || c.skipMediaReason !== 'duration_over_60s')))) throw new Error('Invalid frozen corpus allowlist');
    return scope;
  }
  if (scope?.schemaVersion !== 'video1_manifest_v1' || scope.courseId !== COURSE_ID || scope.videoId !== VIDEO_ID
    || scope.chunks?.length !== 117 || scope.ids?.length !== 117 || new Set(scope.ids).size !== 117
    || IDS.some(id => !scope.ids.includes(id)) || new Set(scope.chunks.map(c => c.chunkId)).size !== 117
    || scope.chunks.some(c => !IDS.includes(c.chunkId) || c.videoId !== VIDEO_ID || c.courseId !== COURSE_ID
      || !Number.isFinite(c.startSec) || !Number.isFinite(c.endSec) || c.startSec < 0 || c.endSec <= c.startSec
      || c.endSec - c.startSec > 60 || typeof c.text !== 'string' || !c.text.trim())) throw new Error('Invalid V1 allowlist');
  return scope;
}
function readManifest(file, approval) {
  const bytes = fs.readFileSync(file);
  if (!/^[a-f0-9]{64}$/.test(approval || '') || sha(bytes) !== approval) throw new Error('Manifest approval hash mismatch');
  return validateScope(JSON.parse(bytes));
}
module.exports = { VIDEO_ID, COURSE_ID, IDS, CORPUS, specification, expectedKinds, expectedRecords, sha, validateScope, readManifest };
