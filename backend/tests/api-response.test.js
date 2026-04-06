const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { buildSuccessResponse, buildErrorResponse } = require('../src/utils/apiResponse');

describe('api response helpers', () => {
  it('builds success responses', () => {
    assert.deepEqual(
      buildSuccessResponse({
        message: 'Created',
        data: { id: '123' },
      }),
      {
        success: true,
        message: 'Created',
        data: { id: '123' },
      },
    );
  });

  it('builds error responses', () => {
    assert.deepEqual(
      buildErrorResponse({
        message: 'Unauthorized',
        code: 'UNAUTHORIZED',
      }),
      {
        success: false,
        message: 'Unauthorized',
        error: {
          code: 'UNAUTHORIZED',
        },
      },
    );
  });
});
