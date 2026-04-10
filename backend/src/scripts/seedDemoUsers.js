const mongoose = require('mongoose');
const { connectDatabase } = require('../config/database');
const { seedDemoData } = require('../services/demoSeed.service');

async function run() {
  await connectDatabase();
  await seedDemoData();
  await mongoose.disconnect();
}

run().catch((error) => {
  console.error('Failed to seed demo data.', error);
  process.exit(1);
});
