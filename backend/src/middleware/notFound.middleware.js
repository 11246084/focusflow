const AppError = require('../utils/appError');

function notFoundHandler(req, res, next) {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, 404, 'NOT_FOUND'));
}

module.exports = {
  notFoundHandler,
};
