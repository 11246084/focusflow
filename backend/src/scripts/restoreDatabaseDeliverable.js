// 還原資料庫交付包（exportDatabaseDeliverable.js 的產出）。
// 用法：
//   npm run db:restore-deliverable -- --from <dir> --verify-only
//   npm run db:restore-deliverable -- --from <dir> --target-db <name> [--drop] [--skip-search-indexes]
// 目標連線：RESTORE_MONGODB_URI，未設定時用 backend/.env 的 MONGODB_URI。
// --target-db 必須等於連線字串裡的 database 名稱；目標已有資料時，未加 --drop 一律拒絕寫入。
const dns = require('dns');
const path = require('path');
const { MongoClient } = require('mongodb');
const env = require('../config/env');
const {
  DatabaseDeliverableError,
  readManifest,
  redactUri,
  restoreDatabase,
  verifyPackage,
} = require('../services/databaseDeliverable.service');

dns.setServers(['8.8.8.8', '8.8.4.4']);

function parseCliArgs(argv = []) {
  const options = {
    packageDir: null,
    targetDb: null,
    drop: false,
    skipSearchIndexes: false,
    verifyOnly: false,
  };
  const takeValue = (flag, index) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new DatabaseDeliverableError(`${flag} requires a value.`, 'DB_DELIVERABLE_CLI_INVALID');
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--from') {
      options.packageDir = path.resolve(takeValue(flag, index));
      index += 1;
    } else if (flag === '--target-db') {
      options.targetDb = takeValue(flag, index);
      index += 1;
    } else if (flag === '--drop') {
      options.drop = true;
    } else if (flag === '--skip-search-indexes') {
      options.skipSearchIndexes = true;
    } else if (flag === '--verify-only') {
      options.verifyOnly = true;
    } else {
      throw new DatabaseDeliverableError(`Unknown argument: ${flag}`, 'DB_DELIVERABLE_CLI_INVALID');
    }
  }

  if (!options.packageDir) {
    throw new DatabaseDeliverableError('--from is required.', 'DB_DELIVERABLE_CLI_INVALID');
  }
  if (!options.verifyOnly && !options.targetDb) {
    throw new DatabaseDeliverableError(
      '--target-db is required unless --verify-only is set.',
      'DB_DELIVERABLE_CLI_INVALID',
    );
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const uri = process.env.RESTORE_MONGODB_URI || env.mongodbUri;
  let client;
  try {
    const options = parseCliArgs(argv);

    if (options.verifyOnly) {
      // 只驗證檔案完整性，不連資料庫。
      const manifest = await readManifest(options.packageDir);
      const verification = await verifyPackage(options.packageDir, manifest);
      console.log(JSON.stringify({
        success: verification.ok,
        createdAt: manifest.createdAt,
        gitCommit: manifest.gitCommit,
        collections: manifest.collections.map(({ name, count }) => ({ name, count })),
        ...verification,
      }, null, 2));
      if (!verification.ok) process.exitCode = 1;
      return;
    }

    client = new MongoClient(uri, { connectTimeoutMS: 10000, serverSelectionTimeoutMS: 10000 });
    await client.connect();
    const db = client.db();

    if (db.databaseName !== options.targetDb) {
      throw new DatabaseDeliverableError(
        `--target-db "${options.targetDb}" does not match connected database "${db.databaseName}".`,
        'DB_DELIVERABLE_TARGET_MISMATCH',
      );
    }

    console.log(JSON.stringify({ target: redactUri(uri), database: db.databaseName, drop: options.drop }));
    const report = await restoreDatabase({
      db,
      packageDir: options.packageDir,
      drop: options.drop,
      skipSearchIndexes: options.skipSearchIndexes,
      log: (message) => console.log(message),
    });

    console.log(JSON.stringify({ success: report.ok, ...report }, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({
      success: false,
      code: error instanceof DatabaseDeliverableError ? error.code : 'DB_DELIVERABLE_RESTORE_FAILED',
      message: error.message || 'Restore failed.',
    }));
    process.exitCode = 1;
  } finally {
    if (client) await client.close();
  }
}

if (require.main === module) main();

module.exports = { main, parseCliArgs };
