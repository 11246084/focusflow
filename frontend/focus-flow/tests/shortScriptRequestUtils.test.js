import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  AUTO_REFRESH_INTERVAL_MS,
  createLatestGuard,
  needsAutoRefresh,
} from '../src/pages/shortScriptRequestUtils.js';

describe('最新請求檢查', () => {
  it('只有最後一次 next() 的代號是目前有效的', () => {
    const guard = createLatestGuard();
    const first = guard.next();
    assert.equal(guard.isCurrent(first), true);
    const second = guard.next();
    assert.equal(guard.isCurrent(second), true);
    assert.equal(guard.isCurrent(first), false);
  });

  it('慢的舊回應晚到時被拒絕，新回應被接受', () => {
    const guard = createLatestGuard();
    const slowA = guard.next();
    const fastB = guard.next();
    const applied = [];
    if (guard.isCurrent(fastB)) applied.push('B');
    if (guard.isCurrent(slowA)) applied.push('A');
    assert.deepEqual(applied, ['B']);
  });

  it('代號遞增且從未發出的代號無效', () => {
    const guard = createLatestGuard();
    const a = guard.next();
    const b = guard.next();
    assert.ok(b > a);
    assert.equal(guard.isCurrent(0), false);
    assert.equal(guard.isCurrent(b + 1), false);
  });

  it('各自獨立的 guard 不互相影響', () => {
    const list = createLatestGuard();
    const detail = createLatestGuard();
    const listToken = list.next();
    const detailToken = detail.next();
    detail.next();
    assert.equal(list.isCurrent(listToken), true);
    assert.equal(detail.isCurrent(detailToken), false);
  });
});

describe('自動重新整理判斷', () => {
  const row = (key) => ({ status: { key } });

  it('等待中的狀態需要自動重新整理', () => {
    ['upload_waiting', 'uploading', 'in_review', 'approved_waiting_upload', 'upload_needs_admin'].forEach((key) => {
      assert.equal(needsAutoRefresh([row(key)]), true, key);
    });
  });

  it('需要教師動手或已結束的狀態不需要', () => {
    ['to_film', 'changes_requested', 'asset_rejected', 'upload_failed', 'published', 'dismissed', 'to_generate'].forEach((key) => {
      assert.equal(needsAutoRefresh([row(key)]), false, key);
    });
  });

  it('任一筆在等就需要，空清單或非陣列不需要', () => {
    assert.equal(needsAutoRefresh([row('to_film'), row('uploading')]), true);
    assert.equal(needsAutoRefresh([]), false);
    assert.equal(needsAutoRefresh(undefined), false);
    assert.equal(needsAutoRefresh([null, {}]), false);
  });

  it('也接受直接帶 key 的狀態物件', () => {
    assert.equal(needsAutoRefresh([{ key: 'in_review' }]), true);
  });

  it('間隔是 15 秒', () => {
    assert.equal(AUTO_REFRESH_INTERVAL_MS, 15000);
  });
});
