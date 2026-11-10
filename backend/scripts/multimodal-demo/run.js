const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { parseArgs } = require('node:util');
const { retrieveMultimodal } = require('../../src/services/multimodalRetrieval.service');
const { createCase } = require('./cases');

const root = path.resolve(__dirname, '../../..');

async function run() {
  const { values } = parseArgs({ options: {
    case: { type: 'string', default: 'normal' },
    mode: { type: 'string', default: 'equal' },
    fail: { type: 'string' }, missing: { type: 'string' },
    video: { type: 'string' }, python: { type: 'string' },
    output: { type: 'string', default: path.join(root, '.local-tools/multimodal-demo') },
    'no-media': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('npm run demo:multimodal -- --case normal|rescue|empty --mode equal|text_weighted --fail audio --missing visual --video PATH --python PATH --output PATH --no-media');
    return;
  }
  for (const option of ['fail', 'missing']) {
    if (values[option] && !['text', 'audio', 'visual'].includes(values[option])) throw new RangeError(`Invalid ${option} channel.`);
  }
  const scenario = createCase(values.case, values);
  const output = path.resolve(values.output);
  fs.mkdirSync(output, { recursive: true });
  console.log('本機多模態流程展示：真實切片＋範例 Chunk＋Mock Embedding／Mock 檢索');
  console.log('Gemini、Atlas 與 RAG 尚未接入。範例文字與時間不代表原片實際內容。');
  let media = null;
  if (!values['no-media']) {
    const python = values.python || path.join(root, 'STT_Whisper/.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    const video = values.video || path.join(root, 'backend/uploads/1785570957608-aiA10_1140119_1.mp4');
    const chunksPath = path.join(output, 'example-chunks.json');
    fs.writeFileSync(chunksPath, JSON.stringify(scenario.chunks, null, 2));
    const result = spawnSync(python, [path.join(root, 'STT_Whisper/src/segment_media_embedding.py'),
      '--video', path.resolve(video), '--chunks', chunksPath, '--output', path.join(output, 'media'), '--max-cost-usd', '0'],
    { encoding: 'utf8', timeout: 300000 });
    if (result.stdout) console.log(result.stdout.trim());
    if (result.error || result.status !== 0) throw new Error('影音處理失敗。請檢查 Python、原片路徑與 FFmpeg，詳見 README。');
    media = JSON.parse(fs.readFileSync(path.join(output, 'media/manifest.json'), 'utf8'));
    console.log(`實際原片 ${media.source}，時長 ${media.durationSec} 秒`);
    console.table(media.records.map((record) => ({ chunk: record.chunkId, modality: record.modality,
      original: `${record.startSec}–${record.endSec}`, sample: `${record.sampleStartSec}–${record.sampleEndSec}`,
      status: record.status, bytes: record.mediaBytes, reused: record.reused })));
  } else {
    console.log('本次略過真實切片，只展示 Mock 排名。');
  }
  const retrieval = await retrieveMultimodal({ ...scenario, mode: values.mode });
  console.log(scenario.question);
  console.log('Mock 三路候選與通道狀態');
  for (const [channel, list] of Object.entries(retrieval.lists)) {
    console.log(`${channel}: ${retrieval.diagnostics[channel].status}`);
    console.table(list.map((item, index) => ({ rank: index + 1, chunk: item.chunkId, score: item.score,
      startSec: item.startSec, endSec: item.endSec })));
  }
  console.log(`實際 RRF 計算 k=${retrieval.k}，權重 ${JSON.stringify(retrieval.weights)}`);
  console.table(retrieval.matches.map((item, index) => ({ rank: index + 1, chunk: item.chunkId,
    fusionScore: item.fusionScore.toFixed(8), retrievedBy: item.retrievedBy.join(','),
    channelRanks: JSON.stringify(item.channelRanks), time: `${item.startSec}–${item.endSec}` })));
  const report = { case: values.case, labels: { chunks: 'synthetic example', media: media ? 'real local slices' : 'not run',
    embeddings: 'mock-sha256-v1', retrieval: 'mock candidates', fusion: 'real RRF', rag: 'not connected' },
  question: scenario.question, mediaManifest: media ? path.join(output, 'media/manifest.json') : null, ...retrieval };
  const variant = [values.fail && `fail-${values.fail}`, values.missing && `missing-${values.missing}`].filter(Boolean).join('-');
  const reportPath = path.join(output, `result-${values.case}-${values.mode}${variant ? `-${variant}` : ''}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`詳細結果與每路貢獻 ${reportPath}`);
  if (retrieval.matches[0]) console.log(`可交給未來 RAG 的範例證據 ${retrieval.matches[0].text}，原始時間 ${retrieval.matches[0].startSec}–${retrieval.matches[0].endSec} 秒`);
}

if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { run };
