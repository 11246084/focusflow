const dns = require('node:dns');
const fs = require('node:fs/promises');
const path = require('node:path');
const { MongoClient } = require('mongodb');
const env = require('../config/env');
const { detectAvatarMimeType } = require('../services/avatar.service');

// One-time move of legacy filesystem avatars (AVATAR_UPLOAD_DIR) into the avatars collection.
// Run it on the machine that actually holds the files (the VM). Atlas is shared, so a machine
// without the files must never clear metadata another machine can still migrate: missing files
// are only reported unless --clear-missing is passed. Dry-run by default; files are never deleted.

const LEGACY_FILENAME = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:jpg|png|webp)$/i;

function parseArgs(argv) {
  const args = { apply: false, clearMissing: false };

  for (const token of argv) {
    if (token === '--apply') {
      args.apply = true;
      continue;
    }
    if (token === '--clear-missing') {
      args.clearMissing = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (args.clearMissing && !args.apply) {
    throw new Error('--clear-missing requires --apply.');
  }

  return args;
}

async function readLegacyAvatar(filename) {
  // Accept only server-generated basenames so stored metadata cannot become a traversal path.
  if (typeof filename !== 'string' || !LEGACY_FILENAME.test(filename)) {
    return null;
  }

  try {
    return await fs.readFile(path.join(env.avatarUploadDir, filename));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function main() {
  // Same workaround as server.js: some networks refuse Node's SRV lookup for mongodb+srv URIs.
  dns.setServers(['8.8.8.8', '8.8.4.4']);
  const args = parseArgs(process.argv.slice(2));
  const client = new MongoClient(env.mongodbUri, {
    connectTimeoutMS: 15000,
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 1,
  });
  const summary = {
    migrated: [],
    alreadyMigrated: [],
    missingFile: [],
    invalidFile: [],
    cleared: [],
  };

  try {
    await client.connect();
    const db = client.db();
    const users = db.collection('users');
    const avatars = db.collection('avatars');

    if (args.apply) {
      await avatars.createIndex({ userId: 1 }, { unique: true });
    }

    const cursor = users.find(
      { 'avatar.filename': { $exists: true } },
      { projection: { email: 1, avatar: 1 } },
    );

    for await (const user of cursor) {
      const label = { userId: String(user._id), email: user.email };

      if (await avatars.findOne({ userId: user._id }, { projection: { _id: 1 } })) {
        summary.alreadyMigrated.push(label);
        if (args.apply) {
          await users.updateOne({ _id: user._id }, { $unset: { 'avatar.filename': '' } });
        }
        continue;
      }

      const buffer = await readLegacyAvatar(user.avatar.filename);
      if (!buffer) {
        summary.missingFile.push(label);
        if (args.clearMissing) {
          await users.updateOne({ _id: user._id }, { $set: { avatar: null } });
          summary.cleared.push(label);
        }
        continue;
      }

      const mimeType = detectAvatarMimeType(buffer);
      if (!mimeType) {
        summary.invalidFile.push(label);
        continue;
      }

      if (args.apply) {
        const updatedAt = user.avatar.updatedAt || new Date();
        await avatars.updateOne(
          { userId: user._id },
          {
            $setOnInsert: {
              userId: user._id,
              data: buffer,
              mimeType,
              size: buffer.length,
              createdAt: new Date(),
              updatedAt,
            },
          },
          { upsert: true },
        );
        await users.updateOne(
          { _id: user._id },
          { $set: { avatar: { mimeType, updatedAt } } },
        );
      }
      summary.migrated.push({ ...label, bytes: buffer.length });
    }

    console.log(JSON.stringify({
      mode: args.apply ? 'apply' : 'dry-run',
      avatarDirectory: env.avatarUploadDir,
      counts: Object.fromEntries(
        Object.entries(summary).map(([key, items]) => [key, items.length]),
      ),
      ...summary,
    }, null, 2));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('migrateAvatarsToMongo failed:', error.message);
    process.exitCode = 1;
  });
}
