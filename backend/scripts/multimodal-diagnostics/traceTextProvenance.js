const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { createHash } = require('node:crypto');
const { MongoClient } = require('mongodb');
const { VIDEO_IDS, safeLabel } = require('./run');

function vectorDigest(vector) {
  if (!Array.isArray(vector) || vector.length !== 3072 || !vector.every(Number.isFinite)) {
    throw new TypeError('Expected a finite 3072 dimensional vector');
  }
  const buffer = Buffer.alloc(vector.length * 8);
  vector.forEach((value, index) => buffer.writeDoubleLE(value, index * 8));
  return createHash('sha256').update(buffer).digest('hex');
}

async function compareArtifacts(remote, files) {
  const matches = new Map();
  const artifacts = [];
  for (const file of files) {
    if (fs.statSync(file).size > 100 * 1024 * 1024) throw new RangeError('Artifact exceeds 100 MB read limit');
    const input = fs.createReadStream(file, { encoding: 'utf8' });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    let inspected = 0;
    let matched = 0;
    const models = Object.create(null);
    try {
      for await (const line of lines) {
        if (!line.trim()) continue;
        const row = JSON.parse(line);
        if (!VIDEO_IDS.includes(row.video_id)) continue;
        inspected += 1;
        const key = JSON.stringify([row.video_id, row.chunk_id]);
        const stored = remote.get(key);
        const model = safeLabel(row.embedding_model);
        models[model] = (models[model] || 0) + 1;
        if (stored && stored.digest === vectorDigest(row.embedding)
          && stored.startSec === row.start_sec && stored.endSec === row.end_sec) {
          matches.set(key, { videoId: row.video_id, model });
          matched += 1;
        }
      }
    } finally {
      lines.close();
      input.destroy();
    }
    artifacts.push({ file: path.basename(path.dirname(file)), inspected, matched, declaredModels: models });
  }
  const byVideo = VIDEO_IDS.map((videoId) => ({ videoId,
    atlasCount: [...remote.keys()].filter((key) => JSON.parse(key)[0] === videoId).length,
    matched: [...matches.values()].filter((value) => value.videoId === videoId).length }));
  return { atlasCount: remote.size, matchedChunks: matches.size, byVideo, artifacts,
    interpretation: 'Exact Float64 vector and timestamp matches establish artifact identity; declared models still rely on artifact metadata and historical logs.' };
}

async function main() {
  const root = path.resolve(__dirname, '../../..');
  const runs = path.join(root, 'STT_Whisper/data/outputs/runs');
  const files = fs.readdirSync(runs).filter((name) => /^run_20260801_(155559|15560[0-5])$/.test(name))
    .sort().map((name) => path.join(runs, name, 'embeddings_text_gemini.jsonl')).filter(fs.existsSync);
  const env = require('../../src/config/env');
  const client = new MongoClient(env.mongodbUri, { serverSelectionTimeoutMS: 15000, socketTimeoutMS: 20000,
    maxPoolSize: 1, retryReads: false, appName: 'focusflow-readonly-provenance' });
  try {
    await client.connect();
    const remote = new Map();
    const cursor = client.db().collection(env.videoSegmentCollection).aggregate([
      { $match: { videoId: { $in: VIDEO_IDS } } }, { $limit: 695 },
      { $project: { _id: 0, videoId: 1, chunkId: 1, startSec: 1, endSec: 1, embedding: 1 } },
    ], { maxTimeMS: 15000, batchSize: 25 });
    for await (const row of cursor) {
      const key = JSON.stringify([row.videoId, row.chunkId]);
      if (remote.has(key)) throw new Error('Duplicate target chunk identity');
      remote.set(key, { digest: vectorDigest(row.embedding), startSec: row.startSec, endSec: row.endSec });
    }
    const report = { checkedAt: new Date().toISOString(), truncated: remote.size >= 695,
      ...await compareArtifacts(remote, files) };
    const output = path.join(root, '.local-tools/multimodal-diagnostics/provenance.json');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    if (report.truncated) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ error: safeLabel(error.code ?? error.name), message: 'Provenance check failed; details redacted.' }));
    process.exitCode = 1;
  } finally { await client.close(); }
}

if (require.main === module) main();
module.exports = { vectorDigest, compareArtifacts };
