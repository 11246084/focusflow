import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  describeAssetState,
  deriveDisplayStatus,
  findScriptAsset,
  groupScripts,
  groupUploadScripts,
} from '../src/services/shortScriptStatus.js';

const script = (status, extra = {}) => ({ _id: 's1', status, ...extra });
const asset = (extra = {}) => ({
  id: 'a1', sourceScriptId: 's1', status: 'draft', reviewStatus: 'pending', upload: { status: 'uploaded', retrySafe: false }, ...extra,
});
const keyOf = (s, assets = []) => deriveDisplayStatus(s, assets).key;

describe('教師看到的腳本狀態', () => {
  it('依腳本狀態直接對應：待生成、需修改、已上架、已否決', () => {
    assert.equal(keyOf(script('evidence_ready')), 'to_generate');
    assert.equal(keyOf(script('changes_requested'), [asset()]), 'changes_requested');
    assert.equal(keyOf(script('approved'), [asset({ status: 'published' })]), 'published');
    assert.equal(keyOf(script('dismissed')), 'dismissed');
  });

  it('generated 沒有成品時是待拍攝上傳', () => {
    assert.equal(keyOf(script('generated')), 'to_film');
    assert.equal(keyOf(script('generated'), [asset({ sourceScriptId: 'other' })]), 'to_film');
  });

  it('generated 的成品傳送中（含剛建立、狀態還是空的）', () => {
    assert.equal(keyOf(script('generated'), [asset({ upload: { status: 'uploading' } })]), 'uploading');
    assert.equal(keyOf(script('generated'), [asset({ upload: { status: null } })]), 'uploading');
  });

  it('上傳失敗依 retrySafe 分成可重試與需管理員確認', () => {
    const retry = deriveDisplayStatus(script('generated'), [asset({ upload: { status: 'failed', retrySafe: true } })]);
    assert.equal(retry.key, 'upload_failed');
    assert.equal(retry.group, 'action');
    const admin = deriveDisplayStatus(script('generated'), [asset({ upload: { status: 'failed', retrySafe: false } })]);
    assert.equal(admin.key, 'upload_needs_admin');
    assert.equal(admin.group, 'waiting');
  });

  it('已傳上 YouTube 且待審核時是待審核', () => {
    assert.equal(keyOf(script('generated'), [asset()]), 'in_review');
  });

  it('審核通過但影片還沒傳完、或退回但腳本未轉狀態時有各自的標示', () => {
    assert.equal(keyOf(script('generated'), [asset({ reviewStatus: 'approved' })]), 'approved_waiting_upload');
    assert.equal(keyOf(script('generated'), [asset({ reviewStatus: 'rejected' })]), 'asset_rejected');
  });

  it('封存的成品不算；有未上架的新一代時優先看它', () => {
    assert.equal(keyOf(script('generated'), [asset({ status: 'archived' })]), 'to_film');
    const assets = [asset({ id: 'old', status: 'published' }), asset({ id: 'new', upload: { status: 'uploading' } })];
    assert.equal(findScriptAsset('s1', assets).id, 'new');
  });
});

describe('成品詳情的三種狀態分開呈現', () => {
  it('待審核、已傳上 YouTube（非公開）、學生看不到', () => {
    assert.deepEqual(describeAssetState(asset({ privacyStatus: 'unlisted' })), {
      review: '待審核', youtube: '已傳上 YouTube（非公開）', studentVisible: false, students: '學生看不到',
    });
  });

  it('已傳上 YouTube 不等於學生看得到；發布後才是學生可見', () => {
    assert.equal(describeAssetState(asset({ reviewStatus: 'approved' })).studentVisible, false);
    assert.equal(describeAssetState(asset({ reviewStatus: 'approved', status: 'published' })).students, '學生可見');
  });
});

describe('腳本頁的分頁', () => {
  it('分成需要你處理、等待中、已上架、已否決，同組最近更新的在前', () => {
    const scripts = [
      script('evidence_ready', { _id: 'e', updatedAt: '2026-10-01' }),
      script('changes_requested', { _id: 'c', updatedAt: '2026-10-03' }),
      script('generated', { _id: 'r', updatedAt: '2026-10-05' }),
      script('approved', { _id: 'p', updatedAt: '2026-10-02' }),
      script('dismissed', { _id: 'd', updatedAt: '2026-10-04' }),
    ];
    const { action, waiting, published, dismissed } = groupScripts(scripts, [asset({ sourceScriptId: 'r' })]);
    assert.deepEqual(action.map((row) => row.script._id), ['c', 'e']);
    assert.deepEqual(waiting.map((row) => row.script._id), ['r']);
    assert.deepEqual(published.map((row) => row.script._id), ['p']);
    assert.deepEqual(dismissed.map((row) => row.script._id), ['d']);
  });
});

describe('上傳短片頁依「誰要動手」分組', () => {
  const scripts = [
    script('evidence_ready', { _id: 'e' }),
    script('generated', { _id: 'f' }),
    script('changes_requested', { _id: 'c' }),
    script('generated', { _id: 'j' }),
    script('generated', { _id: 'n' }),
    script('generated', { _id: 'u' }),
    script('generated', { _id: 'r' }),
    script('generated', { _id: 'w' }),
    script('generated', { _id: 'x' }),
    script('generated', { _id: 'm' }),
    script('approved', { _id: 'p' }),
    script('dismissed', { _id: 'd' }),
  ];
  const assets = [
    asset({ sourceScriptId: 'j', reviewStatus: 'rejected' }),
    asset({ sourceScriptId: 'n', upload: { status: null } }),
    asset({ sourceScriptId: 'u', upload: { status: 'uploading' } }),
    asset({ sourceScriptId: 'r' }),
    asset({ sourceScriptId: 'w', reviewStatus: 'approved' }),
    asset({ sourceScriptId: 'x', upload: { status: 'failed', retrySafe: true } }),
    asset({ sourceScriptId: 'm', upload: { status: 'failed', retrySafe: false } }),
    asset({ sourceScriptId: 'p', status: 'published', reviewStatus: 'approved' }),
  ];
  const ids = (rows) => rows.map((row) => row.script._id).sort();

  it('需要你處理：待拍攝上傳、需修改、成品已退回、可重試的上傳失敗', () => {
    assert.deepEqual(ids(groupUploadScripts(scripts, assets).action), ['c', 'f', 'j', 'x']);
  });

  it('等待中：傳送中（含剛建立）、待審核、審核通過等上架、需管理員處理的上傳失敗', () => {
    assert.deepEqual(ids(groupUploadScripts(scripts, assets).waiting), ['m', 'n', 'r', 'u', 'w']);
  });

  it('retrySafe 不是 true 都算需管理員處理（含沒寫入的情況）', () => {
    const { action, waiting } = groupUploadScripts(
      [script('generated', { _id: 'q' })],
      [asset({ sourceScriptId: 'q', upload: { status: 'failed' } })],
    );
    assert.equal(action.length, 0);
    assert.equal(waiting[0].cue, '等管理員確認');
  });

  it('每列帶著下一步動作或正在等什麼', () => {
    const { action, waiting } = groupUploadScripts(scripts, assets);
    const cueOf = (rows, id) => rows.find((row) => row.script._id === id).cue;
    assert.equal(cueOf(action, 'f'), '上傳');
    assert.equal(cueOf(action, 'x'), '重試');
    assert.equal(cueOf(waiting, 'u'), '傳送到 YouTube 中');
    assert.equal(cueOf(waiting, 'r'), '等待審核');
    assert.equal(cueOf(waiting, 'w'), '等影片傳完後上架');
    assert.equal(cueOf(waiting, 'm'), '等管理員確認');
  });

  it('待生成、已上架、已否決不列在上傳短片頁', () => {
    const { action, waiting } = groupUploadScripts(scripts, assets);
    const listed = [...action, ...waiting].map((row) => row.script._id);
    for (const id of ['e', 'p', 'd']) assert.equal(listed.includes(id), false);
  });
});
