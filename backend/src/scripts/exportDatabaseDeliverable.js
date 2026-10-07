// 匯出資料庫交付包（取代 SQL Server MDF／LDF），只讀不寫。
// 用法：npm run db:export-deliverable -- [--out <dir>] [--exclude a,b] [--allowed-email-domains a,b] [--allow-real-users]
// 來源連線：EXPORT_MONGODB_URI，未設定時用 backend/.env 的 MONGODB_URI。
// 預設拒絕匯出含非 demo 帳號或已綁 LINE 帳號的資料庫；還原方式見 docs/00_Deliverables/Database/README.md。
const dns = require('dns');
const fsp = require('fs/promises');
const path = require('path');
const { execFileSync } = require('child_process');
const { MongoClient } = require('mongodb');
const env = require('../config/env');
const {
  DEFAULT_ALLOWED_EMAIL_DOMAINS,
  DEFAULT_EXCLUDED_COLLECTIONS,
  DatabaseDeliverableError,
  exportDatabase,
  redactUri,
} = require('../services/databaseDeliverable.service');

// Use public resolvers for Atlas SRV lookups in local environments with incomplete DNS forwarding.
dns.setServers(['8.8.8.8', '8.8.4.4']);

const RESTORE_GUIDE_PATH = path.resolve(__dirname, '../../../docs/00_Deliverables/Database/README.md');
const DEFAULT_OUTPUT_ROOT = path.resolve(__dirname, '../../tmp/database-deliverable');

function splitList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function formatStamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
    + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function parseCliArgs(argv = [], now = new Date()) {
  const options = {
    outDir: path.join(DEFAULT_OUTPUT_ROOT, `focusflow-db-${formatStamp(now)}`),
    excludeCollections: [...DEFAULT_EXCLUDED_COLLECTIONS],
    allowedEmailDomains: [...DEFAULT_ALLOWED_EMAIL_DOMAINS],
    allowRealUsers: false,
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
    if (flag === '--out') {
      options.outDir = path.resolve(takeValue(flag, index));
      index += 1;
    } else if (flag === '--exclude') {
      options.excludeCollections = [...new Set([...options.excludeCollections, ...splitList(takeValue(flag, index))])];
      index += 1;
    } else if (flag === '--allowed-email-domains') {
      options.allowedEmailDomains = splitList(takeValue(flag, index));
      index += 1;
    } else if (flag === '--allow-real-users') {
      options.allowRealUsers = true;
    } else {
      throw new DatabaseDeliverableError(`Unknown argument: ${flag}`, 'DB_DELIVERABLE_CLI_INVALID');
    }
  }
  return options;
}

function readGitCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function main(argv = process.argv.slice(2)) {
  const uri = process.env.EXPORT_MONGODB_URI || env.mongodbUri;
  let client;
  try {
    const options = parseCliArgs(argv);
    client = new MongoClient(uri, { connectTimeoutMS: 10000, serverSelectionTimeoutMS: 10000 });
    await client.connect();
    const db = client.db();

    let serverVersion = null;
    try {
      ({ version: serverVersion } = await db.admin().serverInfo());
    } catch {
      // Atlas 低權限帳號可能不能讀 buildInfo，版本留空不影響匯出。
    }

    console.log(JSON.stringify({ source: redactUri(uri), database: db.databaseName, outDir: options.outDir }));
    const manifest = await exportDatabase({
      db,
      outDir: options.outDir,
      excludeCollections: options.excludeCollections,
      allowedEmailDomains: options.allowedEmailDomains,
      allowRealUsers: options.allowRealUsers,
      source: { uri, serverVersion, gitCommit: readGitCommit() },
      log: (message) => console.log(message),
    });

    try {
      await fsp.copyFile(RESTORE_GUIDE_PATH, path.join(options.outDir, '還原說明.md'));
    } catch (error) {
      console.warn(`Restore guide not copied (${error.message}); copy docs/00_Deliverables/Database/README.md manually.`);
    }

    console.log(JSON.stringify({
      success: true,
      outDir: options.outDir,
      database: manifest.source.database,
      users: manifest.privacy.users,
      skipped: manifest.skipped,
      collections: manifest.collections.map(({ name, count, bytes, searchIndexes }) => ({
        name,
        count,
        bytes,
        searchIndexes: searchIndexes.map((index) => index.name),
      })),
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      success: false,
      code: error instanceof DatabaseDeliverableError ? error.code : 'DB_DELIVERABLE_EXPORT_FAILED',
      message: error.message || 'Export failed.',
    }));
    process.exitCode = 1;
  } finally {
    if (client) await client.close();
  }
}

if (require.main === module) main();

module.exports = { main, parseCliArgs };
