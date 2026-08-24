// 匯出指定課程的逐字稿，供 QA 評測題庫與人工核對使用。
// 用法: node scripts/qa-eval/dumpTranscripts.js <courseId> [outDir]
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const courseId = process.argv[2];
const outDir = process.argv[3] || path.join(__dirname, 'out');

if (!courseId) {
  console.error('Usage: node scripts/qa-eval/dumpTranscripts.js <courseId> [outDir]');
  process.exit(1);
}

const SEGMENT_COLLECTION = process.env.VIDEO_SEGMENT_COLLECTION || 'video_segments_text';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;

  const course = await db.collection('courses').findOne({ _id: new mongoose.Types.ObjectId(courseId) });
  if (!course) throw new Error(`Course not found: ${courseId}`);

  const videos = await db.collection('videos')
    .find({ _id: { $in: course.videoIds || [] } })
    .project({ title: 1, durationSec: 1, 'processing.status': 1 })
    .toArray();

  fs.mkdirSync(outDir, { recursive: true });

  const manifest = { courseId, courseTitle: course.title, videos: [] };

  for (const video of videos) {
    const key = String(video._id);
    const segments = await db.collection(SEGMENT_COLLECTION)
      .find({ videoId: key })
      .project({ embedding: 0 })
      .sort({ startSec: 1 })
      .toArray();

    manifest.videos.push({
      videoId: key,
      title: video.title,
      durationSec: video.durationSec,
      status: video.processing?.status,
      segmentCount: segments.length,
    });

    const lines = segments.map((s) => `[${s.chunkId}] ${Math.round(s.startSec)}-${Math.round(s.endSec)}s | ${s.text}`);
    fs.writeFileSync(path.join(outDir, `${video.title.replace(/[^\w.-]/g, '_')}__${key}.txt`), lines.join('\n'), 'utf8');
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(JSON.stringify(manifest, null, 2));
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });
