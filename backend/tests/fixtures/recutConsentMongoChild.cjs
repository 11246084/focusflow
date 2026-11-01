const assert = require('node:assert/strict');
const { connect } = require('../helpers/recutConsentMongo');
const { createRecutConsentService } = require('../../src/services/recutConsent.service');
const { TERMS_VERSION } = require('../../src/constants/recutConsent');
const { ids } = require('../helpers/recutConsentFake');

async function main() {
  const [dbName, worker] = process.argv.slice(2);
  assert.match(worker, /^[ab]$/);
  const f = await connect(dbName);
  try {
    const service = createRecutConsentService({ repository: f.repository });
    // Two independent node processes race on the same teacher aggregate.
    await Promise.all(Array.from({ length: 8 }, (_, index) => service.recordConsent({
      user: { id: ids.teacher, role: 'teacher' }, courseId: ids.course, kind: 'voice',
      choice: index % 2 ? 'original' : 'synthetic', requestId: `mongo-${worker}-${index}`, termsVersion: TERMS_VERSION,
    })));
    process.stdout.write(`worker-${worker}:8\n`);
  } finally { await f.connection.close(); }
}
main().catch((error) => { process.stderr.write(`${error.code || error.name}: ${error.message}\n`); process.exitCode = 1; });
