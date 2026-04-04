const mongoose = require('mongoose');
const AppError = require('./appError');

function assertObjectId(id, label = 'resource') {
  if (!mongoose.isValidObjectId(id)) {
    throw new AppError(`Invalid ${label} id.`, 400, 'INVALID_ID');
  }
}

module.exports = {
  assertObjectId,
};
