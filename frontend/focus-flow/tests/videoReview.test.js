import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { REJECTION_REASONS } from '../src/constants/videoReviewReasons.js';
import {
  REVIEW_REASON_CODES,
  buildReviewRequest,
  getReviewErrorMessage,
  getShortAsset,
  listShortAssets,
  shouldReloadAfterReviewError,
  submitReviewAndReadback,
  submitVideoReview,
  validateRejectionReasons,
} from '../src/services/videoReview.js';

const originalFetch = globalThis.fetch;
const originalLocalStorage = globalThis.localStorage;

function response(body, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return body;
    },
  };
}

function reviewError(code, status = 409, message = code) {
  return Object.assign(new Error(message), { code, status });
}

describe('ShortAsset review API contract', () => {
  beforeEach(() => {
    globalThis.localStorage = {
      getItem(key) {
        return key === 'ff_token' ? 'teacher-token' : null;
      },
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.localStorage = originalLocalStorage;
  });

  it('uses the real list and detail endpoints and returns server data', async () => {
    const calls = [];
    globalThis.fetch = async (...args) => {
      calls.push(args);
      return response({
        success: true,
        data: calls.length === 1
          ? { items: [{ id: 'asset-1', generationVersion: 3 }] }
          : { id: 'asset/1', generationVersion: 4 },
      });
    };

    const list = await listShortAssets({ reviewStatus: 'pending', limit: 12 });
    const detail = await getShortAsset('asset/1');

    assert.deepEqual(list, { items: [{ id: 'asset-1', generationVersion: 3 }] });
    assert.deepEqual(detail, { id: 'asset/1', generationVersion: 4 });
    assert.equal(calls[0][0], 'http://localhost:4000/api/v1/shorts?reviewStatus=pending&limit=12');
    assert.equal(calls[1][0], 'http://localhost:4000/api/v1/shorts/asset%2F1');
    assert.equal(calls[0][1].headers.Authorization, 'Bearer teacher-token');
  });

  it('submits shortAssetId, decision, reasons, and expectedGenerationVersion', async () => {
    const calls = [];
    globalThis.fetch = async (...args) => {
      calls.push(args);
      return response({
        success: true,
        data: { id: 'short-123', reviewStatus: 'rejected', generationVersion: 7 },
      });
    };
    const reasons = [
      { code: 'subtitleIssue', note: '第 12 秒字幕不同步' },
      { code: 'other', note: '需要重新剪輯' },
    ];

    const result = await submitVideoReview({
      shortAssetId: 'short-123',
      status: 'rejected',
      expectedGenerationVersion: 7,
      reasons,
    });

    assert.equal(calls.length, 1);
    const [url, options] = calls[0];
    assert.equal(url, 'http://localhost:4000/api/v1/shorts/short-123/review');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.headers.Authorization, 'Bearer teacher-token');
    assert.deepEqual(JSON.parse(options.body), {
      status: 'rejected',
      expectedGenerationVersion: 7,
      reasons,
    });
    assert.equal(result.reviewStatus, 'rejected');
  });

  it('does not send rejection reasons for an approval', () => {
    assert.deepEqual(buildReviewRequest({
      status: 'approved',
      expectedGenerationVersion: 2,
      reasons: [{ code: 'other', note: 'must not leak' }],
    }), {
      status: 'approved',
      expectedGenerationVersion: 2,
    });
  });
});

describe('ShortAsset rejection validation', () => {
  it('keeps the frontend reason enum aligned with all six backend reason codes', () => {
    assert.deepEqual(REVIEW_REASON_CODES, [
      'contentIncorrect',
      'audioIssue',
      'visualQuality',
      'subtitleIssue',
      'incomplete',
      'other',
    ]);
    assert.deepEqual(REJECTION_REASONS.map(({ code }) => code), REVIEW_REASON_CODES);
  });

  it('requires at least one valid reason and a nonblank other note', () => {
    assert.match(validateRejectionReasons([]), /至少勾選一項/);
    assert.match(validateRejectionReasons([{ code: 'unknown', note: '' }]), /無效/);
    assert.match(validateRejectionReasons([{ code: 'other', note: '   ' }]), /必填說明/);
    assert.equal(validateRejectionReasons([{ code: 'other', note: '補充原因' }]), '');
    assert.equal(validateRejectionReasons([{ code: 'audioIssue', note: '' }]), '');
  });

  it('accepts exactly 500 characters and rejects more than 500', () => {
    assert.equal(validateRejectionReasons([
      { code: 'contentIncorrect', note: 'a'.repeat(500) },
    ]), '');
    assert.match(validateRejectionReasons([
      { code: 'contentIncorrect', note: 'a'.repeat(501) },
    ]), /最多 500 字/);
  });
});

describe('ShortAsset review readback and recovery', () => {
  it('only reports success after submit completes and the detail is read back', async () => {
    const events = [];
    const review = {
      shortAssetId: 'asset-1',
      status: 'approved',
      expectedGenerationVersion: 5,
    };
    const latest = { id: 'asset-1', reviewStatus: 'approved', generationVersion: 5 };

    const result = await submitReviewAndReadback(review, {
      submit: async (received) => {
        events.push(['submit', received]);
        return { reviewStatus: 'approved' };
      },
      readback: async (shortAssetId) => {
        events.push(['readback', shortAssetId]);
        return latest;
      },
    });

    assert.strictEqual(result, latest);
    assert.deepEqual(events, [
      ['submit', review],
      ['readback', 'asset-1'],
    ]);
  });

  for (const code of ['SHORT_ASSET_REVIEW_STALE', 'SHORT_ASSET_REVIEW_CONFLICT']) {
    it(`${code} reloads server state once without automatically resubmitting`, async () => {
      let submitCount = 0;
      let readbackCount = 0;
      const originalError = reviewError(code);
      const latest = { id: 'asset-1', generationVersion: 9, reviewStatus: 'pending' };
      const review = {
        shortAssetId: 'asset-1',
        status: 'rejected',
        expectedGenerationVersion: 8,
        reasons: [{ code: 'other', note: '保留使用者輸入' }],
      };

      await assert.rejects(
        submitReviewAndReadback(review, {
          submit: async () => {
            submitCount += 1;
            throw originalError;
          },
          readback: async () => {
            readbackCount += 1;
            return latest;
          },
        }),
        (error) => error === originalError && error.latestAsset === latest,
      );

      assert.equal(submitCount, 1);
      assert.equal(readbackCount, 1);
      assert.deepEqual(review.reasons, [{ code: 'other', note: '保留使用者輸入' }]);
    });
  }

  it('does not enter a success path or perform a conflict reload for ordinary failures', async () => {
    let readbackCount = 0;
    const error = reviewError('VALIDATION_ERROR', 400, 'Invalid reasons');

    await assert.rejects(
      submitReviewAndReadback({ shortAssetId: 'asset-1' }, {
        submit: async () => { throw error; },
        readback: async () => {
          readbackCount += 1;
          return { id: 'asset-1' };
        },
      }),
      (received) => received === error,
    );
    assert.equal(readbackCount, 0);
  });

  it('maps authorization, missing, validation, network, and 5xx failures to actionable UX', () => {
    assert.match(getReviewErrorMessage(reviewError('SHORT_ASSET_ACCESS_DENIED', 403)), /沒有權限/);
    assert.match(getReviewErrorMessage(reviewError('SHORT_ASSET_NOT_FOUND', 404)), /找不到/);
    assert.equal(
      getReviewErrorMessage(reviewError('VALIDATION_ERROR', 400, '其他說明為必填')),
      '其他說明為必填',
    );
    assert.match(getReviewErrorMessage(new TypeError('Failed to fetch')), /無法連線/);
    assert.match(getReviewErrorMessage(reviewError('INTERNAL_SERVER_ERROR', 503)), /伺服器暫時/);
    assert.equal(shouldReloadAfterReviewError(reviewError('SHORT_ASSET_REVIEW_STALE')), true);
    assert.equal(shouldReloadAfterReviewError(reviewError('SHORT_ASSET_REVIEW_CONFLICT')), true);
    assert.equal(shouldReloadAfterReviewError(reviewError('VALIDATION_ERROR', 400)), false);
  });
});
