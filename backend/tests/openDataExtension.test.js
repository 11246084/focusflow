const assert = require('node:assert/strict');
const { after, before, beforeEach, describe, it } = require('node:test');
const {
  ids,
  newObjectId,
  resetStore,
  startServer,
  stopServer,
  jsonRequest,
  loginAs,
  store,
} = require('./helpers/backendTestHarness');
const env = require('../src/config/env');
const { rankVideos, resetCatalogCache } = require('../src/services/openDataExtension.service');
const {
  buildImportPlan,
  normalizeLearningField,
  normalizeLearningStage,
  parseArgs,
  splitKeywords,
} = require('../src/scripts/importOpenEduVideos');
const { parseCsv } = require('../src/scripts/importStudents');

function seedVideo(overrides = {}) {
  return {
    _id: newObjectId(),
    sourceNo: String(store.openEduVideos.length + 1),
    title: '光合作用的過程',
    description: '說明植物如何利用光能製造養分',
    keywords: ['光合作用', '植物', '葉綠體'],
    learningField: '自然科學',
    learningStage: '國小',
    videoUrl: 'https://stv.naer.edu.tw/video/1',
    ...overrides,
  };
}

// 關鍵字出現在超過 2% 影片會被當成泛用詞，所以測試目錄要有足夠數量的無關影片。
function withFiller(videos, count = 100) {
  const filler = Array.from({ length: count }, (_, index) => seedVideo({
    sourceNo: 'filler-' + index,
    title: '無關影片' + index,
    keywords: ['無關主題' + index],
  }));
  return [...filler, ...videos];
}

describe('延伸學習推薦：關鍵字比對', () => {
  it('問題含有完整關鍵字才命中', () => {
    const catalog = withFiller([seedVideo()]);
    assert.equal(rankVideos(catalog, '什麼是光合作用？').length, 1);
    assert.deepEqual(rankVideos(catalog, '植物如何製造養分'), []);
  });

  it('只有字面片段相符不算命中（不做二連詞比對）', () => {
    const catalog = withFiller([seedVideo({ keywords: ['光合作用'], title: '合作學習與作用力' })]);
    assert.deepEqual(rankVideos(catalog, '合作與作用'), []);
  });

  it('疑問詞不會當成關鍵字命中', () => {
    const catalog = withFiller([seedVideo({ keywords: ['有什麼', '說明', '老師'] })]);
    assert.deepEqual(rankVideos(catalog, 'OpenCV 有什麼差異？請說明，老師'), []);
  });

  it('泛用關鍵字（出現在超過 2% 影片）不列入比對', () => {
    const catalog = Array.from({ length: 100 }, (_, index) => seedVideo({
      sourceNo: String(index),
      keywords: index < 10 ? ['教學方法'] : ['其他'],
    }));
    assert.deepEqual(rankVideos(catalog, '教學方法是什麼'), []);
  });

  it('兩字關鍵字需要同一支影片有兩個關鍵字命中', () => {
    const catalog = withFiller([seedVideo({ keywords: ['作用', '細胞'] })]);
    assert.deepEqual(rankVideos(catalog, '作用'), []);
    assert.equal(rankVideos(catalog, '細胞的作用').length, 1);
  });

  it('純英文短關鍵字不比對', () => {
    const catalog = withFiller([seedVideo({ keywords: ['all', 'python'] })]);
    assert.deepEqual(rankVideos(catalog, 'all you need'), []);
    assert.equal(rankVideos(catalog, 'python 是什麼').length, 1);
  });

  it('依相符關鍵字排序並最多回傳 3 筆', () => {
    const base = Array.from({ length: 200 }, (_, index) => seedVideo({ sourceNo: 'x' + index, keywords: ['其他' + index] }));
    const catalog = [
      ...base,
      seedVideo({ sourceNo: 'a', title: 'A', keywords: ['光合作用'] }),
      seedVideo({ sourceNo: 'b', title: 'B', keywords: ['光合作用', '葉綠體'] }),
      seedVideo({ sourceNo: 'c', title: 'C', keywords: ['光合作用'] }),
      seedVideo({ sourceNo: 'd', title: 'D', keywords: ['光合作用'] }),
    ];
    const results = rankVideos(catalog, '光合作用發生在葉綠體嗎');
    assert.equal(results.length, 3);
    assert.equal(results[0].title, 'B');
  });

  it('不回傳內部欄位', () => {
    const [result] = rankVideos(withFiller([seedVideo()]), '光合作用');
    assert.deepEqual(Object.keys(result).sort(), ['learningField', 'learningStage', 'title', 'videoUrl']);
  });
});

describe('POST /api/v1/qa/extended-resources', () => {
  let serverContext;

  before(async () => {
    serverContext = await startServer();
  });

  after(async () => {
    await stopServer(serverContext.server);
  });

  beforeEach(() => {
    resetStore();
    resetCatalogCache();
    env.openDataExtensionEnabled = true;
  });

  after(() => {
    env.openDataExtensionEnabled = false;
  });

  async function post(body, token) {
    return jsonRequest(serverContext.baseUrl, '/api/v1/qa/extended-resources', {
      method: 'POST',
      token,
      body,
    });
  }

  it('flag 關閉時回 404', async () => {
    env.openDataExtensionEnabled = false;
    const token = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const result = await post({ courseId: ids.publishedCourse, question: '光合作用' }, token);
    assert.equal(result.status, 404);
    assert.equal(result.body.error.code, 'NOT_FOUND');
  });

  it('未登入時回傳 401', async () => {
    const result = await post({ courseId: ids.publishedCourse, question: '光合作用' });
    assert.equal(result.status, 401);
  });

  it('缺少必填欄位時回傳 400', async () => {
    const token = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const result = await post({ courseId: ids.publishedCourse }, token);
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
  });

  it('沒有課程權限時回傳 403', async () => {
    const token = await loginAs(serverContext.baseUrl, 'teacher2@focusflow.local', 'Teacher123!');
    const result = await post({ courseId: ids.teacherCourse, question: '光合作用' }, token);
    assert.equal(result.status, 403);
    assert.equal(result.body.error.code, 'COURSE_ACCESS_DENIED');
  });

  it('課程不存在時回傳 404', async () => {
    const token = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const result = await post({ courseId: newObjectId(), question: '光合作用' }, token);
    assert.equal(result.status, 404);
    assert.equal(result.body.error.code, 'COURSE_NOT_FOUND');
  });

  it('命中時回傳推薦影片與資料來源授權標示', async () => {
    store.openEduVideos.push(...withFiller([seedVideo()]));
    const token = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const result = await post({ courseId: ids.publishedCourse, question: '光合作用是什麼' }, token);

    assert.equal(result.status, 200);
    assert.equal(result.body.data.videos.length, 1);
    assert.equal(result.body.data.videos[0].title, '光合作用的過程');
    assert.equal(result.body.data.attribution.source, '國家教育研究院愛學網');
    assert.equal(result.body.data.attribution.license, '政府資料開放授權條款－第1版');
  });

  it('沒有命中時回傳空陣列而不是錯誤', async () => {
    store.openEduVideos.push(...withFiller([seedVideo()]));
    const token = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const result = await post({ courseId: ids.publishedCourse, question: 'JWT authentication' }, token);

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.data.videos, []);
  });
});

describe('愛學網 CSV 匯入計畫', () => {
  const header = 'NO,標題,影片長度,製作者,類型,製作年份,描述說明,關鍵字,點讚,點閱次數,下載次數,學習領域,學習階段,學習內容,學習表現,議題,核心素養,授權方式,影片網址';

  function csvRow({ no, title, keywords = '光合作用、植物', url = 'https://stv.naer.edu.tw/v/1' }) {
    return `${no},${title},,,,,說明,"${keywords}",,,,自然科學,國小,,,,,CC,${url}`;
  }

  it('解析欄位、拆關鍵字並略過無效列', () => {
    const rows = parseCsv([
      header,
      csvRow({ no: '1', title: '光合作用' }),
      csvRow({ no: '2', title: '', url: 'https://x.test/2' }),
      csvRow({ no: '3', title: '壞網址', url: 'javascript:alert(1)' }),
      csvRow({ no: '1', title: '重複編號' }),
    ].join('\n'));
    const plan = buildImportPlan(rows);

    assert.equal(plan.valid.length, 1);
    assert.deepEqual(plan.valid[0].keywords, ['光合作用', '植物']);
    assert.equal(plan.valid[0].learningStage, '國小');
    assert.equal(plan.invalid.length, 3);
  });

  it('缺少必要欄位時拒絕匯入', () => {
    assert.throws(() => buildImportPlan(parseCsv('NO,標題\n1,光合作用')), /影片網址/);
  });

  it('--apply 必須附 --expected-count', () => {
    assert.throws(() => parseArgs(['--file', 'a.csv', '--apply']), /expected-count/);
  });

  it('關鍵字支援多種分隔符號', () => {
    assert.deepEqual(splitKeywords('甲、乙,丙；丁'), ['甲', '乙', '丙', '丁']);
  });

  it('學習階段代碼轉成學制名稱，多值以頓號連接', () => {
    assert.equal(normalizeLearningStage('五'), '高中');
    assert.equal(normalizeLearningStage('四\n五'), '國中、高中');
    assert.equal(normalizeLearningStage('二\n二'), '國小中年級');
    assert.equal(normalizeLearningStage(''), '');
    assert.equal(normalizeLearningStage('未知'), '未知');
  });

  it('學習領域的換行多值以頓號連接', () => {
    assert.equal(normalizeLearningField('國語文\n綜合活動'), '國語文、綜合活動');
  });
});
