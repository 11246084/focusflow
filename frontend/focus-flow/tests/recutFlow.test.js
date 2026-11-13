import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  batchRoom, buildScriptLines, formatShotRange, describeShort, formatAgo, sourceLabel, withCutMarks, consentNeeds, isFixedRenderFailure, renderFailureText, describeScript, durationStatus, isBusyState, playbackTimeline, recallLastScript,
  recutErrorText, rejectScope, rememberLastScript, sentenceAt, sortManageItems, toManageItem,
} from '../src/services/recutFlow.js';
import * as api from '../src/services/recut.js';
import { isValidSubPage } from '../src/components/navigationConfig.js';
import { resolveNotificationTarget } from '../src/utils/notificationTarget.js';

const s = (id, selected, extra = {}) => ({ id, text: id, startSec: 0, endSec: 2, selected, ...extra });

describe('recut 狀態對應的步驟與待辦', () => {
  it('確認講稿、製作失敗、確認成品歸為等你處理', () => {
    for (const state of ['script_review', 'script_approved', 'render_failed', 'asset_review']) {
      assert.equal(describeScript({ recut: { state } }).bucket, 'mine', state);
    }
  });

  it('背景處理中的狀態歸為處理中', () => {
    for (const state of ['queued', 'generating', 'updating', 'render_queued', 'rendering', 'asset_approved']) {
      assert.equal(isBusyState(state), true, state);
    }
  });

  it('idle 且最近一次工作失敗時顯示產生失敗', () => {
    assert.equal(describeScript({ recut: { state: 'idle' } }, { status: 'failed' }).label, '產生失敗');
  });

  it('數位分身依成品狀態對應步驟：沒影片待上傳、待審核等你確認、不做了不列入待辦', () => {
    const avatar = (status) => ({ _id: 's1', productionMode: 'avatar', status });
    assert.equal(describeShort(avatar('generated'), []).label, '待上傳影片');
    assert.equal(describeShort(avatar('generated'), [{ id: 'a1', sourceScriptId: 's1', status: 'draft', reviewStatus: 'pending', upload: { status: 'uploaded' } }]).bucket, 'mine');
    assert.equal(describeShort(avatar('dismissed'), []).bucket, 'closed');
    assert.equal(describeShort(avatar('evidence_ready'), []).action, '產生腳本');
  });

  it('這門課還能開始的支數扣掉已在產生講稿中的', () => {
    const busy = (state) => ({ recut: { state } });
    assert.equal(batchRoom([busy('queued'), busy('generating'), busy('updating'), busy('script_review')]), 3);
    assert.equal(batchRoom(Array.from({ length: 6 }, () => busy('generating'))), 0);
  });

  it('管理清單把等你處理排在最前，同組新的在前', () => {
    const items = sortManageItems([
      { bucket: 'done', updatedAt: '2026-11-12' },
      { bucket: 'mine', updatedAt: '2026-11-10' },
      { bucket: 'waiting', updatedAt: '2026-11-12' },
      { bucket: 'mine', updatedAt: '2026-11-11' },
    ]);
    assert.deepEqual(items.map((i) => `${i.bucket}:${i.updatedAt}`), ['mine:2026-11-11', 'mine:2026-11-10', 'waiting:2026-11-12', 'done:2026-11-12']);
  });

  it('管理清單的標題用學生原本的問法', () => {
    const item = toManageItem({ _id: 'x', courseId: 'c', topic: '主題', sourceQuestions: [{ question: '為什麼？' }], productionMode: 'recut', recut: { state: 'asset_review' } }, { title: '課' });
    assert.equal(item.question, '為什麼？');
    assert.equal(item.action, '確認成品');
  });
});

describe('講稿逐句排列', () => {
  it('留用句前後各一句略過句留在原位，更遠的收成一行', () => {
    const lines = buildScriptLines([s('a', false), s('b', false), s('c', false), s('d', true), s('e', false), s('f', false)]);
    assert.deepEqual(lines.map((l) => (l.type === 'gap' ? `gap${l.count}` : `${l.role}:${l.sentence.id}`)),
      ['gap2', 'omitted:c', 'kept:d', 'omitted:e', 'gap1']);
  });

  it('展開的略過行改為逐句列出', () => {
    const lines = buildScriptLines([s('a', false), s('b', false), s('c', true)], new Set(['gap-a']));
    assert.deepEqual(lines.map((l) => l.sentence?.id), ['a', 'b', 'c']);
  });

  it('老師移除的句子留在原位，不收進略過行', () => {
    const lines = buildScriptLines([s('a', false), s('b', false), s('c', false, { teacherChanged: true }), s('d', false), s('e', false), s('f', true)]);
    assert.ok(lines.some((l) => l.sentence?.id === 'c'));
  });

  it('30／65 秒刻線放在第一句從該秒數之後開始的留用句前面', () => {
    const lines = [1, 2, 3].map((n) => ({ type: 'sentence', role: 'kept', sentence: { id: `k${n}` } }));
    const marked = withCutMarks(lines, [{ id: 'k1', from: 0 }, { id: 'k2', from: 31 }, { id: 'k3', from: 66 }]);
    assert.deepEqual(marked.map((l) => l.id || l.sentence.id), ['k1', 'mark-30', 'k2', 'mark-65', 'k3']);
    assert.equal(withCutMarks(lines.slice(0, 1), [{ id: 'k1', from: 0 }]).length, 1);
  });

  it('來源寫出影片名稱與原片時間範圍', () => {
    assert.equal(sourceLabel({ evidence: [{ videoId: 'v1', videoTitle: '第三週' }] }, { videoId: 'v1', startSec: 40, endSec: 180 }), '第三週・0:40–3:00');
    assert.equal(sourceLabel({}, { videoId: 'v9', startSec: 0, endSec: 125 }), '原片 0:00–2:05');
    assert.equal(sourceLabel({}, { videoId: 'v9', sentences: [{ startSec: 40, endSec: 44 }, { startSec: 90, endSec: 95 }] }), '原片 0:40–1:35');
  });

  it('多久前更新', () => {
    const now = Date.parse('2026-11-13T10:00:00Z');
    assert.equal(formatAgo('2026-11-13T09:59:30Z', now), '剛剛');
    assert.equal(formatAgo('2026-11-13T08:00:00Z', now), '2 小時前');
    assert.equal(formatAgo('2026-11-10T10:00:00Z', now), '3 天前');
  });

  it('片頭句不在原位重複', () => {
    const lines = buildScriptLines([s('a', true, { opening: true }), s('b', true)]);
    assert.deepEqual(lines.map((l) => l.sentence.id), ['b']);
  });

  it('成品播放時依片頭在前的順序推算目前那一句', () => {
    const timeline = playbackTimeline([s('a', true), s('b', true, { opening: true, startSec: 10, endSec: 13 })]);
    assert.equal(sentenceAt(timeline, 1), 'b');
    assert.equal(sentenceAt(timeline, 4), 'a');
    assert.equal(sentenceAt(timeline, 99), null);
  });
});

describe('時長、退回與錯誤文案', () => {
  it('30～65 秒以外說明差幾秒', () => {
    assert.equal(durationStatus(48).valid, true);
    assert.equal(durationStatus(70).message, '超過 5 秒');
    assert.equal(durationStatus(25).message, '還差 5 秒');
  });

  it('內容類退回原因回到講稿，其他回到製作', () => {
    assert.equal(rejectScope(['subtitleIssue']), 'presentation');
    assert.equal(rejectScope(['subtitleIssue', 'contentIncorrect']), 'content');
    assert.equal(rejectScope(['other']), 'content');
  });

  it('製作失敗依代碼說明原因，固定類失敗不提供重新製作', () => {
    assert.match(renderFailureText({ errorCode: 'RECUT_TEXT_OVERFLOW' }), /圖卡文字太長/);
    assert.match(renderFailureText(null), /重新製作/);
    assert.equal(isFixedRenderFailure('RECUT_TEXT_OVERFLOW'), true);
    assert.equal(isFixedRenderFailure('RECUT_COMPLETION_FAILED'), false);
  });

  it('斷線時不把瀏覽器的英文錯誤給老師看', () => {
    assert.equal(recutErrorText(new TypeError('Failed to fetch')), '連不上伺服器，請確認網路後再試。');
    assert.notEqual(recutErrorText({ name: 'AbortError', code: 'STALE_AUTH_RESPONSE', message: 'x' }), '連不上伺服器，請確認網路後再試。');
  });

  it('功能未開放與已知代碼轉成教師看得懂的文字', () => {
    assert.equal(recutErrorText({ status: 404, code: 'NOT_FOUND' }), '短影片功能目前未開放。');
    assert.match(recutErrorText({ status: 422, code: 'RECUT_DURATION_INVALID' }), /30～65/);
  });

  it('第一次使用要補內容同意與原音', () => {
    assert.deepEqual(consentNeeds({ decisions: {}, voiceMode: null }), { content: true, voice: true });
    assert.deepEqual(consentNeeds({ decisions: { content: { choice: 'granted' } }, voiceMode: 'original' }), { content: false, voice: false });
  });

  it('記住最後打開的那一支', () => {
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    rememberLastScript({ courseId: 'c1', scriptId: 's1' }, storage);
    assert.deepEqual(recallLastScript(storage), { courseId: 'c1', scriptId: 's1' });
  });
});

describe('導覽與通知', () => {
  it('側欄改為短影片製作與管理，數位分身舊頁仍可進入', () => {
    for (const sub of ['shortStudio', 'shortManage', 'shortScripts', 'shortUploads', 'reviewShorts']) assert.equal(isValidSubPage('teacher', sub), true, sub);
  });

  it('recut 完成通知打開短影片製作', () => {
    assert.equal(resolveNotificationTarget({ source: 'recut_task_finished', scriptId: 's1', courseIds: ['c1'] }).sub, 'shortStudio');
  });
});

describe('recut API 請求內容', () => {
  const originalFetch = globalThis.fetch;
  let calls;
  beforeEach(() => {
    calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
      return { ok: true, status: 200, async json() { return { data: { id: 't1' } }; } };
    };
  });
  afterEach(() => { globalThis.fetch = originalFetch; });

  const review = { versionId: 'v1', revision: 3, recut: { currentAssetId: 'a1', currentAssetGenerationVersion: 2 } };

  it('逐句修改帶版本與修訂號', async () => {
    await api.editSelection('s1', review, [{ sentenceId: 'x', action: 'add' }]);
    assert.equal(calls[0].url, '/api/v1/short-scripts/s1/recut/selection');
    assert.equal(calls[0].options.method, 'PATCH');
    assert.deepEqual(calls[0].body, { versionId: 'v1', expectedRevision: 3, changes: [{ sentenceId: 'x', action: 'add' }] });
  });

  it('退回成品帶成品版次與範圍', async () => {
    await api.rejectAsset('s1', review, { scope: 'content', reasons: [{ code: 'contentIncorrect' }] });
    assert.deepEqual(calls[0].body, { versionId: 'v1', expectedRevision: 3, assetId: 'a1', generationVersion: 2, scope: 'content', reasons: [{ code: 'contentIncorrect' }] });
  });

  it('建立短片直接指定 recut', async () => {
    await api.createRecutScript('c1', 'topic-1');
    assert.deepEqual(calls[0].body, { topicKey: 'topic-1', productionMode: 'recut' });
  });

  it('全選撤回不送逐支清單', async () => {
    await api.withdrawConsent('c1', { kind: 'voice', termsVersion: 'v', requestId: 'r', selectAll: true, selectedAssetIds: ['a'] });
    assert.deepEqual(calls[0].body, { kind: 'voice', termsVersion: 'v', requestId: 'r', selectAll: true });
  });
});

it('formatShotRange 把鏡頭時間改成和講稿相同的格式', () => {
  assert.equal(formatShotRange('5-15s'), '0:05–0:15');
  assert.equal(formatShotRange('60–75s'), '1:00–1:15');
  assert.equal(formatShotRange('開場'), '開場');
  assert.equal(formatShotRange(undefined), '');
});
