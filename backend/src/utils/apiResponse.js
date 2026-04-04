function buildSuccessResponse({ message = 'OK', data, meta } = {}) {
  const payload = {
    success: true,
    message,
  };

  if (data !== undefined) {
    payload.data = data;
  }

  if (meta !== undefined) {
    payload.meta = meta;
  }

  return payload;
}

function sendSuccess(res, { statusCode = 200, message = 'OK', data, meta } = {}) {
  return res.status(statusCode).json(buildSuccessResponse({ message, data, meta }));
}

function buildErrorResponse({ message = 'Request failed', code = 'INTERNAL_SERVER_ERROR', details } = {}) {
  const payload = {
    success: false,
    message,
    error: {
      code,
    },
  };

  if (details !== undefined) {
    payload.error.details = details;
  }

  return payload;
}

module.exports = {
  buildSuccessResponse,
  sendSuccess,
  buildErrorResponse,
};
