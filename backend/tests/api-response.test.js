const assert = require('node:assert/strict');
const { buildSuccessResponse, buildErrorResponse } = require('../src/utils/apiResponse');

const successResponse = buildSuccessResponse({
  message: 'Created',
  data: {
    id: '123',
  },
});

assert.deepEqual(successResponse, {
  success: true,
  message: 'Created',
  data: {
    id: '123',
  },
});

const errorResponse = buildErrorResponse({
  message: 'Unauthorized',
  code: 'UNAUTHORIZED',
});

assert.deepEqual(errorResponse, {
  success: false,
  message: 'Unauthorized',
  error: {
    code: 'UNAUTHORIZED',
  },
});

console.log('api-response.test.js passed');
