'use strict';

const SCHEMA_VERSION = 'recut-v1';
const LAYOUTS = ['panel-over-teacher'];

// 與 backend 的 SUBTITLE_MAX_LENGTH 同值（字幕是短字卡，不是口白）。
const SUBTITLE_MAX_LENGTH = 20;

const LIMITS = {
  minSeconds: 30,
  maxSeconds: 65,
  minSceneSeconds: 1.5,
  maxClips: 16,
  maxScenes: 14,
  endCardSeconds: { min: 1, max: 6, default: 3.6 },
  // 對齊後的剪點落在引用 chunk 時間範圍外多少秒以內仍可接受
  chunkTimeToleranceSeconds: 2,
  // 剪後再轉錄與預期文字的最低相似度
  cutTextSimilarity: 0.75,
};

const CUT_MODES = ['snap', 'exact'];
const SUBTITLE_LEVELS = ['condensed', 'corrected'];

// 疊加層（可附在任一場景）
const STAMP_TONES = ['alert'];

module.exports = {
  SCHEMA_VERSION,
  LAYOUTS,
  SUBTITLE_MAX_LENGTH,
  LIMITS,
  CUT_MODES,
  SUBTITLE_LEVELS,
  STAMP_TONES,
};
