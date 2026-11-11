const COURSE_ID = '6a6da68456dd124511ec5196';
const VIDEO_ID = '6a6da68e56dd124511ec51b4';

// These are deliberately synthetic examples, not an export of active Atlas chunks.
const chunks = [
  { courseId: COURSE_ID, videoId: VIDEO_ID, chunkId: `${VIDEO_ID}_demo_0001`, startSec: 10, endSec: 12, text: '範例逐字稿：全連先生廣告。' },
  { courseId: COURSE_ID, videoId: VIDEO_ID, chunkId: `${VIDEO_ID}_demo_0002`, startSec: 22, endSec: 32, text: '範例逐字稿：人工智慧與機器學習。' },
  { courseId: COURSE_ID, videoId: VIDEO_ID, chunkId: `${VIDEO_ID}_demo_0003`, startSec: 40, endSec: 50, text: '範例逐字稿：課程介紹。' },
];

function createCase(name, { fail, missing } = {}) {
  const ranks = {
    normal: { text: [1, 2, 0], audio: [1, 0], visual: [1, 2] },
    rescue: { text: [1, 2], audio: [0, 2], visual: [0, 1] },
    empty: { text: [], audio: [], visual: [] },
  }[name];
  if (!ranks) throw new RangeError('Unknown demo case.');
  const searchers = {};
  for (const channel of ['text', 'audio', 'visual']) {
    if (channel === missing) continue;
    searchers[channel] = async () => {
      if (channel === fail) throw new Error('Injected mock channel failure');
      return ranks[channel].map((index, rank) => ({ ...chunks[index], score: 1 / (rank + 1) }));
    };
  }
  return { chunks, searchers, scope: { courseId: COURSE_ID, allowedVideoIds: [VIDEO_ID] },
    question: name === 'rescue' ? '老師在哪裡講到全聯先生廣告？（Mock 情境）' : '人工智慧是什麼？（Mock 情境）' };
}

module.exports = { createCase, chunks };
