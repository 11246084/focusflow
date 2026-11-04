const assert = require('node:assert/strict');
const { after, afterEach, before, beforeEach, describe, it } = require('node:test');
const {
  env,
  ids,
  newObjectId,
  resetStore,
  startServer,
  stopServer,
  createLineSignature,
  postLineWebhook,
  store,
  jsonRequest,
  loginAs,
} = require('./helpers/backendTestHarness');
const {
  buildRichMenuDefinitions,
  createRichMenus,
  deleteRichMenu,
  rollbackRichMenus,
} = require('../src/scripts/setupLineRichMenus');

const BOUND_MENU_ID = `richmenu-${'1'.repeat(32)}`;
const originalFetch = globalThis.fetch;
const originalEnv = {
  lineChannelAccessToken: env.lineChannelAccessToken,
  lineRichMenuBoundId: env.lineRichMenuBoundId,
  qaDailyAskLimitPerStudent: env.qaDailyAskLimitPerStudent,
  qaMaxQuestionLength: env.qaMaxQuestionLength,
  lineLoginCallbackUrl: env.lineLoginCallbackUrl,
};

// 只攔截 LINE Messaging API；測試打本機 server 的請求照常送出。
function captureLineCalls({ failRichMenu = false } = {}) {
  const calls = [];
  env.lineChannelAccessToken = 'line-access-token-for-tests';
  env.lineRichMenuBoundId = BOUND_MENU_ID;
  globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    if (href.startsWith('https://api.line.me/')) {
      const call = { method: options.method || 'GET', path: new URL(href).pathname, body: options.body ? JSON.parse(options.body) : null };
      calls.push(call);
      const ok = !(failRichMenu && call.path.includes('/richmenu'));
      return new Response('{}', { status: ok ? 200 : 400 });
    }
    return originalFetch(url, options);
  };
  return calls;
}

const richMenuCalls = (calls) => calls.filter((call) => call.path.includes('/richmenu'));
const replyMessages = (calls) => calls
  .filter((call) => call.path === '/v2/bot/message/reply')
  .flatMap((call) => call.body.messages);
const replyTexts = (calls) => calls
  .filter((call) => call.path === '/v2/bot/message/reply')
  .flatMap((call) => call.body.messages.map((message) => message.text));

let sequence = 0;
async function postEvent(baseUrl, event, lineUserId = 'line-student-001') {
  sequence += 1;
  const payload = JSON.stringify({
    events: [{ replyToken: `reply-rich-menu-${sequence}`, source: { type: 'user', userId: lineUserId }, ...event }],
  });
  return postLineWebhook(baseUrl, payload, { 'x-line-signature': createLineSignature(payload) });
}

const postText = (baseUrl, text, lineUserId) => postEvent(baseUrl, { type: 'message', message: { type: 'text', text } }, lineUserId);
const postPostback = (baseUrl, data, lineUserId) => postEvent(baseUrl, { type: 'postback', postback: { data } }, lineUserId);
const student = () => store.users.find((user) => user._id === ids.student);

describe('LINE 圖文選單依綁定狀態切換', () => {
  let serverContext;

  before(async () => { serverContext = await startServer(); });
  beforeEach(() => { resetStore(); });
  afterEach(() => {
    Object.assign(env, originalEnv);
    globalThis.fetch = originalFetch;
  });
  after(async () => { await stopServer(serverContext.server); });

  it('未設定選單 ID 時不呼叫 LINE 的選單 API', async () => {
    const calls = captureLineCalls();
    env.lineRichMenuBoundId = '';
    await postText(serverContext.baseUrl, '使用說明');
    assert.equal(richMenuCalls(calls).length, 0);
  });

  it('用綁定碼綁定成功後指定「已綁定」選單並記下選單 ID', async () => {
    const calls = captureLineCalls();
    Object.assign(student(), { lineUserId: undefined, lineRichMenuId: null });
    const token = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const issued = await jsonRequest(serverContext.baseUrl, '/api/v1/line/bind-token', { method: 'POST', token });
    await postText(serverContext.baseUrl, issued.body.data.token, 'line-new-student');

    assert.equal(student().lineUserId, 'line-new-student');
    assert.deepEqual(richMenuCalls(calls).map((call) => `${call.method} ${call.path}`), [
      `POST /v2/bot/user/line-new-student/richmenu/${BOUND_MENU_ID}`,
    ]);
    assert.equal(student().lineRichMenuId, BOUND_MENU_ID);
  });

  it('解除綁定時取消指定，回到預設選單', async () => {
    const calls = captureLineCalls();
    student().lineRichMenuId = BOUND_MENU_ID;
    const token = await loginAs(serverContext.baseUrl, 'student@focusflow.local', 'Student123!');
    const result = await jsonRequest(serverContext.baseUrl, '/api/v1/line/binding', { method: 'DELETE', token });

    assert.equal(result.status, 200);
    assert.deepEqual(richMenuCalls(calls).map((call) => `${call.method} ${call.path}`), [
      'DELETE /v2/bot/user/line-student-001/richmenu',
    ]);
    assert.equal(student().lineRichMenuId, null);
  });

  it('上線前就綁定的舊同學，下次傳訊息時補指定一次，之後不重複指定', async () => {
    const calls = captureLineCalls();
    await postText(serverContext.baseUrl, '使用說明');
    await postText(serverContext.baseUrl, '使用說明');

    assert.equal(richMenuCalls(calls).length, 1);
    assert.equal(student().lineRichMenuId, BOUND_MENU_ID);
  });

  it('指定失敗時不記錄，下次再試，且不影響回覆', async () => {
    const calls = captureLineCalls({ failRichMenu: true });
    const result = await postText(serverContext.baseUrl, '使用說明');

    assert.equal(result.status, 200);
    assert.equal(result.body.data.results[0].handled, true);
    assert.equal(student().lineRichMenuId ?? null, null);
    assert.match(replyMessages(calls)[0].altText, /FocusFlow 使用說明/);
  });

  it('換 LINE 時新的 LINE 拿到已綁定選單，舊的 LINE 回到預設選單', async () => {
    const calls = captureLineCalls();
    const { bindLineAccount } = require('../src/services/line.service');
    const result = await bindLineAccount({ userId: ids.student, lineUserId: 'line-student-new', replaceExisting: true });

    assert.equal(result.replaced, true);
    assert.deepEqual(richMenuCalls(calls).map((call) => `${call.method} ${call.path}`), [
      `POST /v2/bot/user/line-student-new/richmenu/${BOUND_MENU_ID}`,
      'DELETE /v2/bot/user/line-student-001/richmenu',
    ]);
  });

  it('已綁定的人重新加好友時重新指定選單', async () => {
    const calls = captureLineCalls();
    student().lineRichMenuId = BOUND_MENU_ID;
    await postEvent(serverContext.baseUrl, { type: 'follow' });
    assert.equal(richMenuCalls(calls).length, 1);
  });

  it('未綁定的人加好友時不指定選單', async () => {
    const calls = captureLineCalls();
    await postEvent(serverContext.baseUrl, { type: 'follow' }, 'line-stranger');
    assert.equal(richMenuCalls(calls).length, 0);
  });
});

describe('LINE 選單指令', () => {
  let serverContext;

  before(async () => { serverContext = await startServer(); });
  beforeEach(() => { resetStore(); });
  afterEach(() => {
    Object.assign(env, originalEnv);
    globalThis.fetch = originalFetch;
  });
  after(async () => { await stopServer(serverContext.server); });

  it('今日額度回覆剩餘次數，網頁與 LINE 合併計算', async () => {
    const calls = captureLineCalls();
    env.qaDailyAskLimitPerStudent = 5;
    env.qaMaxQuestionLength = 50;
    for (let index = 0; index < 2; index += 1) {
      store.questions.push({ _id: newObjectId(), userId: ids.student, courseId: ids.publishedCourse, question: `q${index}`, status: 'answered', askedAt: new Date() });
    }
    const result = await postText(serverContext.baseUrl, '今日額度');

    assert.equal(result.body.data.results[0].type, 'today_quota');
    assert.match(replyTexts(calls)[0], /今天還能問 3 次（每天 5 次，已用 2 次）/);
    assert.match(replyTexts(calls)[0], /每題最多 50 字/);
    assert.equal(store.questions.length, 2);
  });

  it('沒有每日上限時說明不限次數', async () => {
    const calls = captureLineCalls();
    env.qaDailyAskLimitPerStudent = 0;
    await postPostback(serverContext.baseUrl, 'action=today_quota');
    assert.match(replyTexts(calls)[0], /沒有限制/);
  });

  it('未綁定的人按今日額度時請他先綁定', async () => {
    const calls = captureLineCalls();
    const result = await postPostback(serverContext.baseUrl, 'action=today_quota', 'line-stranger');
    assert.equal(result.body.data.results[0].reason, 'user_not_bound');
    assert.match(replyTexts(calls)[0], /請先完成帳號綁定/);
  });

  it('使用說明以 Flex 輪播呈現，已綁定的卡片附切換課程與今日額度按鈕', async () => {
    const calls = captureLineCalls();
    env.lineLoginCallbackUrl = 'https://focusflow.example/line/callback';
    await postText(serverContext.baseUrl, '使用說明');

    const [message] = replyMessages(calls);
    assert.equal(message.type, 'flex');
    assert.equal(message.contents.type, 'carousel');
    const bubbles = message.contents.contents;
    assert.deepEqual(bubbles.map((bubble) => bubble.header.contents[1].text), [
      '選擇課程', '直接輸入問題', '查看今日額度', '在網頁看完整內容',
    ]);
    const actions = bubbles.map((bubble) => bubble.footer?.contents[0].action ?? null);
    assert.equal(actions[0].data, 'action=switch_course');
    assert.equal(actions[1], null);
    assert.equal(actions[2].data, 'action=today_quota');
    assert.equal(actions[3].uri, 'https://focusflow.example/app');
    assert.match(message.altText, /FocusFlow 使用說明/);
  });

  it('未綁定的人看到的第一張卡片是連結帳號，且不放需要綁定的按鈕', async () => {
    const calls = captureLineCalls();
    env.lineLoginCallbackUrl = 'https://focusflow.example/line/callback';
    await postPostback(serverContext.baseUrl, 'action=help', 'line-stranger');

    const bubbles = replyMessages(calls)[0].contents.contents;
    assert.equal(bubbles[0].header.contents[1].text, '先連結 FocusFlow 帳號');
    assert.equal(bubbles[0].footer.contents[0].action.uri, 'https://focusflow.example/app/line');
    assert.equal(bubbles.some((bubble) => bubble.footer?.contents[0].action.type === 'postback'), false);
    assert.match(replyMessages(calls)[0].altText, /還沒連結/);
  });

  it('沒有網站網址時卡片不放網址按鈕', async () => {
    const calls = captureLineCalls();
    env.lineLoginCallbackUrl = '';
    await postText(serverContext.baseUrl, '使用說明');
    const bubbles = replyMessages(calls)[0].contents.contents;
    assert.equal(bubbles.some((bubble) => bubble.footer?.contents[0].action.type === 'uri'), false);
  });

  it('圖文選單的切換課程按鈕送出課程選單', async () => {
    const calls = captureLineCalls();
    const result = await postPostback(serverContext.baseUrl, 'action=switch_course');
    assert.equal(result.body.data.results[0].type, 'switch_course');
    const reply = calls.find((call) => call.path === '/v2/bot/message/reply');
    // dev 的切換課程已改成 Flex 輪播（每門課一張卡）。
    assert.equal(reply.body.messages[0].type, 'flex');
    assert.equal(reply.body.messages[0].contents.type, 'carousel');
  });

  it('不在白名單的 postback 與看起來像指令的文字不會被誤當成選單動作', async () => {
    captureLineCalls();
    const unknown = await postPostback(serverContext.baseUrl, 'action=constructor');
    assert.equal(unknown.body.data.results[0].reason, 'unsupported_event');
    const text = await postText(serverContext.baseUrl, 'constructor');
    assert.notEqual(text.body.data.results[0].type, 'help');
    assert.ok(text.body.data.results[0].type);
  });
});

describe('圖文選單建立腳本', () => {
  it('未綁定一格開啟 LINE 提問頁，已綁定是 2×2 四格各 1250×843', () => {
    const { unbound, bound } = buildRichMenuDefinitions('https://focusflow.example/ignored/path');
    assert.equal(unbound.body.areas[0].action.uri, 'https://focusflow.example/app/line');
    assert.deepEqual(unbound.body.size, { width: 2500, height: 843 });
    assert.deepEqual(bound.body.size, { width: 2500, height: 1686 });
    assert.match(bound.image, /rich-menu-bound-large\.png$/);
    assert.deepEqual(bound.body.areas.map((area) => [area.bounds.x, area.bounds.y, area.bounds.width, area.bounds.height]), [
      [0, 0, 1250, 843], [1250, 0, 1250, 843], [0, 843, 1250, 843], [1250, 843, 1250, 843],
    ]);
    assert.deepEqual(bound.body.areas.slice(0, 3).map((area) => area.action.data), [
      'action=switch_course',
      'action=today_quota',
      'action=help',
    ]);
    assert.equal(bound.body.areas[3].action.uri, 'https://focusflow.example/app');
    for (const menu of [unbound, bound]) assert.ok(menu.body.chatBarText.length <= 14);
  });

  it('網址不是 https 時拒絕', () => {
    assert.throws(() => buildRichMenuDefinitions('http://focusflow.example'), /https/);
    assert.throws(() => buildRichMenuDefinitions(undefined), /absolute URL/);
  });

  function fakeClient({ failOn } = {}) {
    const log = [];
    let next = 0;
    const step = (name, value) => async (...args) => {
      log.push([name, ...args.filter((arg) => typeof arg === 'string')]);
      if (failOn === name) throw new Error(`${name} failed`);
      return value?.() ?? {};
    };
    return {
      log,
      client: {
        createMenu: step('create', () => { next += 1; return { richMenuId: `richmenu-${String(next).repeat(32)}` }; }),
        uploadImage: step('upload'),
        setDefault: step('setDefault'),
        clearDefault: step('clearDefault'),
        deleteMenu: step('delete'),
      },
    };
  }

  it('建立兩張選單、上傳圖片，最後才把未綁定設為預設', async () => {
    const { client, log } = fakeClient();
    const ids = await createRichMenus({
      client,
      definitions: buildRichMenuDefinitions('https://focusflow.example'),
      readImage: () => Buffer.from('png'),
    });
    assert.deepEqual(ids, { unbound: `richmenu-${'1'.repeat(32)}`, bound: `richmenu-${'2'.repeat(32)}` });
    assert.deepEqual(log.map(([name]) => name), ['create', 'upload', 'create', 'upload', 'setDefault']);
    assert.deepEqual(log.at(-1), ['setDefault', ids.unbound]);
  });

  it('只重建已綁定選單時不建立未綁定選單，也不更動預設選單', async () => {
    const { client, log } = fakeClient();
    const ids = await createRichMenus({
      client,
      definitions: buildRichMenuDefinitions('https://focusflow.example'),
      readImage: () => Buffer.from('png'),
      only: 'bound',
    });
    assert.deepEqual(Object.keys(ids), ['bound']);
    assert.deepEqual(log.map(([name]) => name), ['create', 'upload']);
  });

  it('刪除單一選單時檢查 ID 格式', async () => {
    const { client, log } = fakeClient();
    await assert.rejects(() => deleteRichMenu({ client, richMenuId: 'nope' }), /richmenu-/);
    await deleteRichMenu({ client, richMenuId: `richmenu-${'c'.repeat(32)}` });
    assert.deepEqual(log, [['delete', `richmenu-${'c'.repeat(32)}`]]);
  });

  it('中途失敗時刪掉這次建立的選單，不設預設', async () => {
    const { client, log } = fakeClient({ failOn: 'upload' });
    await assert.rejects(() => createRichMenus({
      client,
      definitions: buildRichMenuDefinitions('https://focusflow.example'),
      readImage: () => Buffer.from('png'),
    }), /upload failed/);
    assert.deepEqual(log.map(([name]) => name), ['create', 'upload', 'delete']);
  });

  it('退回時取消預設並刪除兩張選單，ID 格式不對就停止', async () => {
    const { client, log } = fakeClient();
    await assert.rejects(() => rollbackRichMenus({ client, unboundId: 'x', boundId: 'y' }), /richmenu-/);
    assert.equal(log.length, 0);
    await rollbackRichMenus({ client, unboundId: `richmenu-${'a'.repeat(32)}`, boundId: `richmenu-${'b'.repeat(32)}` });
    assert.deepEqual(log.map(([name]) => name), ['clearDefault', 'delete', 'delete']);
  });
});

describe('LINE 回答卡分段', () => {
  const { splitAnswerParagraphs, buildAnswerFlexMessage } = require('../src/services/line.service');
  const answer = '主要表現在以下幾個方面：一、惡用與犯罪問題：AI可能會被惡用。二、偏見與歧視問題：訓練資料不平均。三、模型訓練的挑戰：仍在研究中。';

  it('在「一、二、三、」列點前換段', () => {
    assert.deepEqual(splitAnswerParagraphs(answer), [
      '主要表現在以下幾個方面：',
      '一、惡用與犯罪問題：AI可能會被惡用。',
      '二、偏見與歧視問題：訓練資料不平均。',
      '三、模型訓練的挑戰：仍在研究中。',
    ]);
  });

  it('數字列點與原本的換行都會分段，小數與一般用詞不會被切開', () => {
    assert.deepEqual(splitAnswerParagraphs('步驟如下：1. 安裝 3.5 版。2. 執行。\n補充說明'), [
      '步驟如下：', '1. 安裝 3.5 版。', '2. 執行。', '補充說明',
    ]);
    assert.deepEqual(splitAnswerParagraphs('統一、唯一的版本。'), ['統一、唯一的版本。']);
  });

  it('太長的段落依句號切開，每段不超過上限（單句本身過長時保留整句）', () => {
    const long = '這是一句很長的說明。'.repeat(20);
    const parts = splitAnswerParagraphs(long, 30);
    assert.ok(parts.length > 1);
    assert.ok(parts.every((part) => part.length <= 30));
    assert.equal(parts.join(''), long);
  });

  it('回答卡每段一個文字元件，列點小標題用粗體', () => {
    const message = buildAnswerFlexMessage({ qaResult: { answer, citations: [] }, courseTitle: 'AI入門基礎課' });
    const texts = message.contents.body.contents.filter((item) => item.type === 'text');
    assert.equal(texts.length, 4);
    assert.deepEqual(texts[1].contents.map((span) => span.text), ['一、惡用與犯罪問題：', 'AI可能會被惡用。']);
    assert.equal(texts[1].contents[0].weight, 'bold');
    assert.equal(texts[0].contents, undefined);
  });
});
