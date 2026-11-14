const fs = require('node:fs');
const { fingerprint, parseBank, annotationReport, evaluationProtocol, inspectInputs, auditRetrieval } = require('../src/services/offlineRetrievalAudit.service');
const { verifyAudit } = require('./verifyMultimodalAudit');

function run(argv) {
  const pendingX01 = argv.includes('--pending-x01');
  argv = argv.filter(arg => arg !== '--pending-x01');
  const inspectionOnly = argv[0] === '--inspect-bank';
  const [bankFile, manifestFile, rankingFile, configFile] = inspectionOnly ? argv.slice(1) : argv;
  const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
  const bank = read(bankFile);
  const questions = parseBank(bank, { allowIncompleteGold: true });
  const gaps = questions.filter(question => question.missingVideos?.length)
    .map(question => ({ questionId: question.id, missingTimeVideos: question.missingVideos }));
  if (gaps.length && !pendingX01) return { status: 'BLOCKED', reason: 'Incomplete human gold labels', bankHash: fingerprint(bank),
    questionCount: questions.length, answerableCount: questions.filter(question => !question.refused).length,
    refusalCount: questions.filter(question => question.refused).length, gaps,
    annotationIssues: annotationReport(bank), protocol: evaluationProtocol(bank),
    protocolHash: fingerprint(evaluationProtocol(bank)) };
  const protocol = evaluationProtocol(bank, { pendingX01 });
  if (inspectionOnly) return { status: pendingX01 ? 'PROVISIONAL_42_VALIDATED' : 'BANK_VALIDATED', bankHash: fingerprint(bank), questionCount: questions.length,
    protocol, protocolHash: fingerprint(protocol), scoringCount: protocol.scoredQuestionIds.length,
    answerableCount: questions.filter(question => !question.refused).length,
    refusalCount: questions.filter(question => question.refused).length };
  const manifest = read(manifestFile);
  if (!rankingFile || !configFile) {
    const inputs = inspectInputs(bank, manifest, { pendingX01 });
    return { status: 'BLOCKED', reason: 'Rankings and bound config required; inspection only',
      bankHash: fingerprint(bank), manifestHash: fingerprint(manifest),
      questionCount: inputs.questions.length, answerableCount: inputs.gold.size,
      refusalCount: inputs.questions.filter(q => q.refused).length,
      pendingQuestionIds: pendingX01 ? ['X01'] : [], chunkCount: inputs.chunks.size,
      missingGold: inputs.missingGold, provenance: manifest.provenance };
  }
  const records = read(rankingFile);
  const config = read(configFile);
  if (pendingX01 !== (config.pendingX01 === true)) throw new Error('CLI and config X01 scoring policy differ');
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
