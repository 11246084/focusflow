const path = require('path');
const dotenv = require('dotenv');

const projectRoot = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(projectRoot, '.env') });

module.exports = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT) || 4000,
  mongodbUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/focusflow',
  jwtSecret: process.env.JWT_SECRET || 'change-me-in-local-env',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  demoSeedEnabled: String(process.env.DEMO_SEED_ENABLED || 'true').toLowerCase() === 'true',
  uploadDir: path.resolve(projectRoot, process.env.UPLOAD_DIR || 'uploads'),
  projectRoot,
};
