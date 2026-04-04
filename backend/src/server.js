const fs = require('fs');
const mongoose = require('mongoose');
const app = require('./app');
const env = require('./config/env');
const { connectDatabase } = require('./config/database');
const { seedDemoUsers } = require('./services/demoSeed.service');

async function startServer() {
  fs.mkdirSync(env.uploadDir, { recursive: true });
  await connectDatabase();

  if (env.demoSeedEnabled) {
    await seedDemoUsers({ silent: true });
  }

  const server = app.listen(env.port, () => {
    console.log(`Focus Flow backend listening on port ${env.port}`);
  });

  const shutdown = async () => {
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((error) => {
  console.error('Failed to start backend.', error);
  process.exit(1);
});
