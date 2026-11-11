const fs = require('node:fs');
const { fingerprint, parseBank, annotationReport, evaluationProtocol, inspectInputs, auditRetrieval } = require('../src/services/offlineRetrievalAudit.service');
const { verifyAudit } = require('./verifyMultimodalAudit');

function run(argv) {
  const inspectionOnly = argv[0] === '--inspect-bank';
  const [bankFile, manifestFile, rankingFile, configFile] = inspectionOnly ? argv.slice(1) : argv;
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const bank = read(bankFile);
  const questions = parseBank(bank, { allowIncompleteGold: true });
  const gaps = questions.filter(question => question.missingVideos?.length)
    .map(question => ({ questionId: question.id, missingTimeVideos: question.missingVideos }));
  if (gaps.length) return { status: 'BLOCKED', reason: 'Incomplete human gold labels', bankHash: fingerprint(bank),
    questionCount: questions.length, answerableCount: questions.filter(question => !question.refused).length,
    refusalCount: questions.filter(question => question.refused).length, gaps,
    annotationIssues: annotationReport(bank), protocol: evaluationProtocol(bank),
    protocolHash: fingerprint(evaluationProtocol(bank)) };
  if (inspectionOnly) return { status: 'BANK_VALIDATED', bankHash: fingerprint(bank), questionCount: questions.length,
    answerableCount: questions.filter(question => !question.refused).length,
    refusalCount: questions.filter(question => question.refused).length };
  const manifest = read(manifestFile);
  if (!rankingFile || !configFile) {
    const inputs = inspectInputs(bank, manifest);
    return { status: 'BLOCKED', reason: 'Rankings and bound config required; inspection only',
      bankHash: fingerprint(bank), manifestHash: fingerprint(manifest),
      questionCount: inputs.questions.length, answerableCount: inputs.gold.size,
      refusalCount: inputs.questions.length - inputs.gold.size, chunkCount: inputs.chunks.size,
      missingGold: inputs.missingGold, provenance: manifest.provenance };
  }
  const records = read(rankingFile);
  const config = read(configFile);
  const report = auditRetrieval({ bank, manifest, records, config });
  verifyAudit({ bank, manifest, records, config, report });
  return { ...report, independentVerification: 'passed' };
}

if (require.main === module) {
  try {
    const result = run(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'BLOCKED') process.exitCode = 2;
  }
  catch (error) { console.log(JSON.stringify({ status: 'BLOCKED', reason: error.message })); process.exitCode = 1; }
}
module.exports = { run };
