const asyncHandler = require('../utils/asyncHandler');
const AppError = require('../utils/appError');
const { sendSuccess } = require('../utils/apiResponse');
const notificationService = require('../services/notification.service');

// Parse query values at the HTTP boundary so the service receives typed, bounded options.
function parseLimit(value) {
  if (value === undefined) {
    return notificationService.DEFAULT_LIMIT;
  }

  if (
    typeof value !== 'string'
    || !/^\d+$/.test(value)
    || Number(value) < 1
    || Number(value) > notificationService.MAX_LIMIT
  ) {
    throw new AppError(
      `limit must be an integer between 1 and ${notificationService.MAX_LIMIT}.`,
      400,
      'VALIDATION_ERROR',
    );
  }

  return Number(value);
}

function parseUnreadOnly(value) {
  if (value === undefined || value === 'false') {
    return false;
  }
  if (value === 'true') {
    return true;
  }
  throw new AppError('unreadOnly must be true or false.', 400, 'VALIDATION_ERROR');
}

function validateBroadcastBody(body = {}) {
  // Keep persisted broadcast text within the Notification schema limits before fanout begins.
  if (typeof body.title !== 'string' || !body.title.trim()) {
    throw new AppError('Title is required.', 400, 'VALIDATION_ERROR');
  }
  if (body.title.trim().length > 120) {
    throw new AppError('Title must be at most 120 characters.', 400, 'VALIDATION_ERROR');
  }
  if (typeof body.content !== 'string' || !body.content.trim()) {
    throw new AppError('Content is required.', 400, 'VALIDATION_ERROR');
  }
  if (body.content.trim().length > 2000) {
    throw new AppError('Content must be at most 2000 characters.', 400, 'VALIDATION_ERROR');
  }
  if (body.urgent !== undefined && typeof body.urgent !== 'boolean') {
    throw new AppError('urgent must be a boolean.', 400, 'VALIDATION_ERROR');
  }

  return {
    title: body.title.trim(),
    content: body.content.trim(),
    urgent: body.urgent ?? false,
  };
}

const listNotifications = asyncHandler(async (req, res) => {
  if (req.query.cursor !== undefined && typeof req.query.cursor !== 'string') {
    throw new AppError('cursor must be a string.', 400, 'VALIDATION_ERROR');
  }

  const result = await notificationService.listNotifications({
    recipientId: req.user.id,
    limit: parseLimit(req.query.limit),
    cursor: req.query.cursor,
    unreadOnly: parseUnreadOnly(req.query.unreadOnly),
  });

  return sendSuccess(res, {
    message: 'Notifications fetched successfully.',
    data: result,
  });
});

const markNotificationRead = asyncHandler(async (req, res) => {
  const notification = await notificationService.markNotificationRead({
    notificationId: req.params.notificationId,
    recipientId: req.user.id,
  });

  return sendSuccess(res, {
    message: 'Notification marked as read.',
    data: {
      notification,
    },
  });
});

const markAllNotificationsRead = asyncHandler(async (req, res) => {
  const result = await notificationService.markAllNotificationsRead(req.user.id);

  return sendSuccess(res, {
    message: 'All notifications marked as read.',
    data: result,
  });
});

const broadcastSystemNotification = asyncHandler(async (req, res) => {
  const payload = validateBroadcastBody(req.body);
  const result = await notificationService.broadcastSystemNotification({
    createdBy: req.user.id,
    ...payload,
  });

  return sendSuccess(res, {
    statusCode: 201,
    message: 'System notification sent.',
    data: result,
  });
});

module.exports = {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  broadcastSystemNotification,
};
