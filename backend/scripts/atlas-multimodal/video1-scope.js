// Fixed acceptance scope. A manifest hash is approved explicitly, never inferred from its contents.
const fs = require('node:fs');
const crypto = require('node:crypto');
const VIDEO_ID = '6a6da68e56dd124511ec51b4';
const COURSE_ID = '6a6da68456dd124511ec5196';
const IDS = Array.from({ length: 117 }, (_, i) => `${VIDEO_ID}_chunk_${String(i + 1).padStart(4, '0')}`);
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function validateScope(scope) {
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
module.exports = { VIDEO_ID, COURSE_ID, IDS, sha, validateScope, readManifest };
