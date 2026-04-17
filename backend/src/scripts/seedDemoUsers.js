const mongoose = require('mongoose');
const { connectDatabase } = require('../config/database');
const { seedDemoData } = require('../services/demoSeed.service');

function isTruthyCliConfig(value) {
  if (value === undefined) {
    return false;
  }

  const normalizedValue = String(value).trim().toLowerCase();

  if (!normalizedValue) {
    return true;
  }

  return !['0', 'false', 'no', 'off'].includes(normalizedValue);
}

async function run() {
  const shouldReset = process.argv.slice(2).includes('--reset')
    || isTruthyCliConfig(process.env.npm_config_reset);

  await connectDatabase();
  await seedDemoData({ reset: shouldReset });
  await mongoose.disconnect();
}

run().catch((error) => {
  console.error('Failed to seed demo data.', error);
  process.exit(1);
});
