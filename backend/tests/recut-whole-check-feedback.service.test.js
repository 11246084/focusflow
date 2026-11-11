'use strict';
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { validateIssues } = require('../src/services/recutWholeCheck.service');
const { INSTRUCTIONS } = require('../src/prompts/recutWholeCheck');

const source = { sentences: [{ id: 's1' }, { id: 's2' }] };
const plan = { scenes: [{ params: { text: 'a' } }, { params: { text: 'b' } }], subtitles: [{ runs: [{ t: 'x' }, { t: 'y' }] }] };
const base = { problem: 'p', proposedChange: 'c', impact: 'i', sentenceIds: ['s1'], presentationPaths: [], selectionChanges: [] };

// 2026-11-05 OpenCV 試產：模型把 plan.clips 剪點回報成 anchor_mismatch，回饋只說「須提供具體呈現路徑」，連續十二次相同失敗。
it('card issue without a path is still rejected and the feedback names the issue and the usable paths', () => {
  const result = validateIssues({ issues: [{ ...base, type: 'card_mismatch', presentationPaths: ['/plan/scenes/0/params'] }, { ...base, type: 'anchor_mismatch' }] }, source, plan);
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /^issues\[1\]（anchor_mismatch） 是圖卡問題/);
  assert.match(result.errors[0], /plan\.clips 的剪點由程式依 selection 產生，不能當成圖卡問題回報/);
  assert.match(result.errors[0], /可用路徑：\/plan\/scenes\/0\/params、\/plan\/scenes\/1\/params、\/plan\/subtitles\/0\/runs\/0\/t、\/plan\/subtitles\/0\/runs\/1\/t/);
});

it('selection and path errors keep failing and say which issue and what to change', () => {
  const noChanges = validateIssues({ issues: [{ ...base, type: 'disconnected_passage' }] }, source, plan);
  assert.equal(noChanges.valid, false);
  assert.match(noChanges.errors[0], /^issues\[0\]（disconnected_passage） 是選段問題，須在 selectionChanges 明列/);
  const badPath = validateIssues({ issues: [{ ...base, type: 'card_mismatch', presentationPaths: ['/plan/clips/2/endAt'] }] }, source, plan);
  assert.equal(badPath.valid, false);
  assert.match(badPath.errors[0], /^issues\[0\]（card_mismatch） 的呈現路徑 \/plan\/clips\/2\/endAt 無效。可用路徑：/);
  const ok = validateIssues({ issues: [{ ...base, type: 'disconnected_passage', selectionChanges: [{ sentenceId: 's2', action: 'remove' }] }] }, source, plan);
  assert.equal(ok.valid, true);
  assert.equal(ok.issues[0].target, 'selection');
});

it('checker instructions explain that clip anchors are program-filled and not anchor_mismatch', () => {
  assert.match(INSTRUCTIONS, /plan\.clips 由程式依 selection 產生/);
  assert.match(INSTRUCTIONS, /兩者指同一個剪點，不是 anchor_mismatch/);
});
