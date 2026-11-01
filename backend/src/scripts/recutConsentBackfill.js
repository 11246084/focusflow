// Offline plan only. This module never imports dotenv, connects to MongoDB or infers
// consent from ShortAsset.consentConfirmed. Execution needs an explicitly injected service.
const fs = require('node:fs/promises');
const { TERMS_VERSION, KINDS } = require('../constants/recutConsent');

function buildPlan(entries) {
  if (!Array.isArray(entries) || entries.length > 1000) throw new Error('A bounded evidence entries array is required.');
  return entries.map((entry, index) => {
    if (!entry || !KINDS.includes(entry.kind) || !entry.courseId || !entry.teacherId
      || typeof entry.evidenceRef !== 'string' || !entry.evidenceRef.trim()) throw new Error(`Entry ${index} needs explicit teacher/course/kind/evidenceRef.`);
    const choices = entry.kind === 'voice' ? ['original', 'synthetic'] : ['granted', 'declined'];
    if (!choices.includes(entry.choice)) throw new Error(`Entry ${index} needs an explicit choice.`);
    if (!entry.requestId) throw new Error(`Entry ${index} needs a stable requestId.`);
    return { courseId: entry.courseId, teacherId: entry.teacherId, videoId: entry.videoId || undefined,
      sourceId: entry.sourceId || undefined, kind: entry.kind, choice: entry.choice, termsVersion: TERMS_VERSION,
      requestId: entry.requestId, evidenceRef: entry.evidenceRef.trim() };
  });
}
async function runBackfill({ entries, service, user, dryRun = true, authorized = false, target = 'offline' }) {
  const plan = buildPlan(entries);
  if (dryRun) return { dryRun: true, writes: 0, plan };
  if (!authorized || target !== 'isolated-local' || user?.role !== 'admin' || typeof service?.recordConsent !== 'function') {
    throw new Error('Execution requires separate authorization, an isolated-local target, an administrator and an injected service. Shared Atlas is prohibited.');
  }
  const results = [];
  for (const item of plan) results.push(await service.recordConsent({ ...item, user }));
  return { dryRun: false, writes: results.length, results };
}
async function main(argv) {
  if (argv.length !== 1 || argv[0].startsWith('--')) throw new Error('Usage: node src/scripts/recutConsentBackfill.js evidence-plan.json (dry-run only)');
  // The explicit file must be an evidence plan, never a configuration or secret file.
  if (!/\.json$/i.test(argv[0]) || /(?:^|[/\\])(?:\.env[^/\\]*|CLAUDE\.local[^/\\]*|[^/\\]*credentials[^/\\]*)$/i.test(argv[0])) throw new Error('Only an explicit non-secret JSON evidence plan is accepted.');
  const result = await runBackfill({ entries: JSON.parse(await fs.readFile(argv[0], 'utf8')) });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
if (require.main === module) main(process.argv.slice(2)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { buildPlan, runBackfill };
