const bcrypt = require('bcryptjs');
const AppError = require('./appError');

async function assertPassword(password, currentHash) {
  if (typeof password !== 'string' || password.length < 8 || !/[a-z]/i.test(password)) {
    throw new AppError('Password must contain at least 8 characters and an English letter.', 400, 'VALIDATION_ERROR');
  }
  if (currentHash && await bcrypt.compare(password, currentHash)) {
    throw new AppError('New password must differ from the current password.', 400, 'VALIDATION_ERROR');
  }
}
module.exports = { assertPassword };
