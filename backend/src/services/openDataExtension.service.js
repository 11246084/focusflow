const OpenEduVideo = require('../models/openEduVideo.model');
const { getCourseByIdOrThrow, assertCanAccessCourse } = require('./courseAccess.service');

// 「延伸學習」推薦：以問題主題比對國家教育研究院愛學網影片清單，只作為答案之外的
// 補充，不進入回答 prompt，也不影響 /qa/ask 的任何路徑。
//
// 比對只用資料集中人工編寫的「關鍵字」欄：整個關鍵字必須原樣出現在問題裡才算命中。
// 不用字元二連詞：資料集是國中小與高中內容，二連詞比對在大專課程問題上會因為
// 「處理」「語言」這類泛用詞推出完全不相干的影片（2026-10-03 以真實問題實測）。
// 寧可不推薦，也不推薦錯的；沒有命中時回空陣列，前端不顯示區塊。

const RESULT_LIMIT = 3;
const MIN_KEYWORD_LENGTH = 2;
const MIN_ASCII_KEYWORD_LENGTH = 4;
// 關鍵字出現在超過這個比例的影片裡就視為泛用詞，不列入比對。
const MAX_KEYWORD_DOCUMENT_RATIO = 0.02;
// 兩字關鍵字（例如「作用」）容易是偶然相符，需要同一支影片有兩個關鍵字命中才採信。
const SHORT_KEYWORD_LENGTH = 2;
const CATALOG_TTL_MS = 10 * 60 * 1000;
const SOURCE_NAME = '國家教育研究院愛學網';
const LICENSE_NAME = '政府資料開放授權條款－第1版';
const SOURCE_URL = 'https://data.gov.tw/dataset/6318';

// 疑問詞與提問用語：資料集裡有「有什麼」「說明」「老師」這類關鍵字，不拿掉會讓
// 每個「…有什麼…」的問題都命中同一支影片。換成分隔符號，避免拿掉後兩側文字被誤接成新詞。
const QUESTION_FILLER_PATTERN = /為什麼|有什麼|是什麼|什麼|怎麼|怎樣|如何|請問|請你|請說明|說明|差異|不同|有哪些|哪些|哪個|可以|是否|有沒有|推薦|老師/g;

let catalogCache = { loadedAt: 0, items: null, index: null };

function normalizeText(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, '');
}

function normalizeQuestion(value) {
  return normalizeText(String(value || '').toLowerCase().replace(QUESTION_FILLER_PATTERN, '|'));
}

// keyword -> 擁有該關鍵字的影片位置。一支影片重複的關鍵字只算一次。
function buildKeywordIndex(catalog) {
  const index = new Map();
  catalog.forEach((video, position) => {
    new Set((video.keywords || []).map(normalizeText)).forEach((keyword) => {
      if (keyword.length < MIN_KEYWORD_LENGTH) return;
      // 純英文關鍵字至少 4 字母：「all」「you」這類短字會在英文問句裡隨機命中。
      if (/^[\x00-\x7f]+$/.test(keyword) && keyword.length < MIN_ASCII_KEYWORD_LENGTH) return;
      if (!index.has(keyword)) index.set(keyword, []);
      index.get(keyword).push(position);
    });
  });
  return index;
}

async function loadCatalog({ now = Date.now() } = {}) {
  if (catalogCache.items && now - catalogCache.loadedAt < CATALOG_TTL_MS) {
    return catalogCache;
  }
  const items = await OpenEduVideo.find({}).lean();
  catalogCache = { loadedAt: now, items, index: buildKeywordIndex(items) };
  return catalogCache;
}

function resetCatalogCache() {
  catalogCache = { loadedAt: 0, items: null, index: null };
}

function rankVideos(catalog, question, index = buildKeywordIndex(catalog)) {
  const text = normalizeQuestion(question);
  if (!text || !catalog.length) return [];

  const matched = new Map();
  index.forEach((positions, keyword) => {
    if (positions.length / catalog.length > MAX_KEYWORD_DOCUMENT_RATIO) return;
    if (!text.includes(keyword)) return;
    const idf = Math.log(catalog.length / positions.length);
    positions.forEach((position) => {
      const entry = matched.get(position) || { score: 0, keywords: [] };
      entry.score += idf * keyword.length;
      entry.keywords.push(keyword);
      matched.set(position, entry);
    });
  });

  return [...matched.entries()]
    .filter(([, entry]) => (
      entry.keywords.some((keyword) => keyword.length > SHORT_KEYWORD_LENGTH)
      || entry.keywords.length >= 2
    ))
    .sort((left, right) => (
      right[1].score - left[1].score
      || String(catalog[left[0]].title).localeCompare(String(catalog[right[0]].title))
    ))
    .slice(0, RESULT_LIMIT)
    .map(([position]) => ({
      title: catalog[position].title,
      videoUrl: catalog[position].videoUrl,
      learningField: catalog[position].learningField || '',
      learningStage: catalog[position].learningStage || '',
    }));
}

async function getExtendedResources({ user, courseId, question }) {
  const course = await getCourseByIdOrThrow(courseId);
  await assertCanAccessCourse(user, course);

  const { items, index } = await loadCatalog();
  const videos = rankVideos(items, question, index);

  return {
    videos,
    attribution: {
      source: SOURCE_NAME,
      license: LICENSE_NAME,
      url: SOURCE_URL,
    },
  };
}

module.exports = {
  rankVideos,
  getExtendedResources,
  resetCatalogCache,
  RESULT_LIMIT,
};
