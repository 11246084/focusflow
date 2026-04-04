const mongoose = require('mongoose');
const { connectDatabase } = require('../config/database');
const { seedDemoUsers } = require('../services/demoSeed.service');

async function run() {
  await connectDatabase();
  const users = await seedDemoUsers();
  console.log(users);
  await mongoose.disconnect();
}

run().catch((error) => {
  console.error('Failed to seed demo users.', error);
  process.exit(1);
});
