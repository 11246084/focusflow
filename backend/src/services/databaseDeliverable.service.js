// 資料庫交付包：校方規範的 MDF／LDF 是 SQL Server 格式，MongoDB 沒有對應檔案。
// 這裡改以「每個 collection 一個 gzip 壓縮的 canonical Extended JSON 檔 + manifest」交付，
// manifest 記錄筆數、SHA-256、一般索引、collection options 與 Atlas Search／Vector 索引定義，
// 還原時先驗證 checksum，再建 collection、寫入資料、重建索引並核對筆數。
const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { BSON } = require('mongodb');

const { EJSON } = BSON;

const FORMAT_VERSION = 1;
const PACKAGE_TOOL = 'focusflow-db-deliverable';
const MANIFEST_FILE = 'manifest.json';
const COLLECTIONS_DIR = 'collections';
const DEFAULT_ALLOWED_EMAIL_DOMAINS = ['focusflow.local'];
// LINE 綁定 token 是一次性秘密，還原後沒有用途，不放進交付包。
const DEFAULT_EXCLUDED_COLLECTIONS = ['line_bind_tokens'];
const SANITIZED_FIELDS = ['users.passwordReset'];
const RESTORE_BATCH_SIZE = 200;

class DatabaseDeliverableError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DatabaseDeliverableError';
    this.code = code;
  }
}

function redactUri(uri) {
  return String(uri || '').replace(/\/\/([^:]+):([^@]+)@/, (_, user) => `//${user}:***@`);
}

// canonical 模式保留 ObjectId／Date／Int32／Double／Long／Binary 型別，避免還原後型別漂移。
function toEjsonLine(document) {
  return `${EJSON.stringify(document, { relaxed: false })}\n`;
}

function fromEjsonLine(line) {
  return EJSON.parse(line, { relaxed: false });
}

function sanitizeDocument(collectionName, document) {
  if (collectionName !== 'users' || !document || !('passwordReset' in document)) {
    return document;
  }
  // 忘記密碼驗證碼雜湊與期限是短期秘密，交付包一律不帶。
  const sanitized = { ...document };
  delete sanitized.passwordReset;
  return sanitized;
}

function normalizeDomains(domains) {
  return [...new Set((domains || []).map((domain) => String(domain).trim().toLowerCase()).filter(Boolean))];
}

// 只回傳統計數字，不回傳 email，避免檢查結果本身外洩個資。
function classifyUsers(users, allowedEmailDomains = DEFAULT_ALLOWED_EMAIL_DOMAINS) {
  const allowed = normalizeDomains(allowedEmailDomains);
  const summary = { total: 0, nonDemoEmail: 0, lineBound: 0, unsafe: 0 };

  for (const user of users) {
    summary.total += 1;
    const email = String(user.email || '').toLowerCase();
    const domain = email.includes('@') ? email.slice(email.lastIndexOf('@') + 1) : '';
    const nonDemoEmail = !allowed.includes(domain);
    const lineBound = Boolean(user.lineUserId);

    if (nonDemoEmail) summary.nonDemoEmail += 1;
    if (lineBound) summary.lineBound += 1;
    if (nonDemoEmail || lineBound) summary.unsafe += 1;
  }

  return summary;
}

async function assessUserPrivacy(db, allowedEmailDomains) {
  const users = await db
    .collection('users')
    .find({}, { projection: { email: 1, lineUserId: 1 } })
    .toArray();
  return classifyUsers(users, allowedEmailDomains);
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { sha256: hash.digest('hex'), bytes };
}

async function listSearchIndexesSafe(collection) {
  try {
    const indexes = await collection.aggregate([{ $listSearchIndexes: {} }]).toArray();
    return {
      searchIndexes: indexes.map((index) => ({
        name: index.name,
        type: index.type || 'search',
        definition: index.latestDefinition || index.definition || null,
      })),
      searchIndexError: null,
    };
  } catch (error) {
    // 本機 MongoDB Community 不支援 $listSearchIndexes，屬預期情況，只記錄原因。
    return { searchIndexes: [], searchIndexError: error.message || String(error) };
  }
}

async function ensureEmptyDirectory(dirPath) {
  try {
    const entries = await fsp.readdir(dirPath);
    if (entries.length) {
      throw new DatabaseDeliverableError(
        `Output directory is not empty: ${dirPath}`,
        'DB_DELIVERABLE_OUTPUT_NOT_EMPTY',
      );
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await fsp.mkdir(path.join(dirPath, COLLECTIONS_DIR), { recursive: true });
}

async function writeCollectionFile(collection, collectionName, filePath) {
  let count = 0;
  async function* lines() {
    // promoteValues=false 讓 Int32／Double 保持 BSON 包裝型別，canonical EJSON 才能原樣寫出。
    const cursor = collection.find({}, { sort: { _id: 1 }, promoteValues: false });
    for await (const document of cursor) {
      count += 1;
      yield toEjsonLine(sanitizeDocument(collectionName, document));
    }
  }
  await pipeline(Readable.from(lines()), zlib.createGzip(), fs.createWriteStream(filePath));
  return count;
}

async function exportDatabase({
  db,
  outDir,
  excludeCollections = DEFAULT_EXCLUDED_COLLECTIONS,
  allowedEmailDomains = DEFAULT_ALLOWED_EMAIL_DOMAINS,
  allowRealUsers = false,
  source = {},
  now = new Date(),
  log = () => {},
}) {
  const collectionInfos = await db.listCollections({}, { nameOnly: false }).toArray();
  const excluded = new Set(excludeCollections);
  const targets = [];
  const skipped = [];

  for (const info of collectionInfos) {
    if (info.name.startsWith('system.')) continue;
    if (excluded.has(info.name)) {
      skipped.push({ name: info.name, reason: 'excluded' });
    } else if (info.type && info.type !== 'collection') {
      skipped.push({ name: info.name, reason: `type:${info.type}` });
    } else {
      targets.push(info);
    }
  }
  targets.sort((a, b) => a.name.localeCompare(b.name));
  skipped.sort((a, b) => a.name.localeCompare(b.name));

  const userPrivacy = await assessUserPrivacy(db, allowedEmailDomains);
  if (userPrivacy.unsafe > 0 && !allowRealUsers) {
    throw new DatabaseDeliverableError(
      `Source contains ${userPrivacy.unsafe} non-demo or LINE-bound user(s); `
        + 'export from a demo database, or pass --allow-real-users after de-identification is approved.',
      'DB_DELIVERABLE_REAL_USERS_FOUND',
    );
  }

  await ensureEmptyDirectory(outDir);

  const collections = [];
  for (const info of targets) {
    const collection = db.collection(info.name);
    const file = `${COLLECTIONS_DIR}/${info.name}.ejson.gz`;
    const filePath = path.join(outDir, file);

    log(`Exporting ${info.name}...`);
    const count = await writeCollectionFile(collection, info.name, filePath);
    const { sha256, bytes } = await hashFile(filePath);
    const indexes = await collection.indexes();
    const { searchIndexes, searchIndexError } = await listSearchIndexesSafe(collection);

    collections.push({
      name: info.name,
      file,
      count,
      sha256,
      bytes,
      options: info.options || {},
      indexes,
      searchIndexes,
      searchIndexError,
    });
  }

  const manifest = {
    formatVersion: FORMAT_VERSION,
    tool: PACKAGE_TOOL,
    createdAt: now.toISOString(),
    gitCommit: source.gitCommit || null,
    source: {
      database: db.databaseName,
      uri: redactUri(source.uri),
      serverVersion: source.serverVersion || null,
    },
    privacy: {
      allowedEmailDomains: normalizeDomains(allowedEmailDomains),
      allowRealUsers: Boolean(allowRealUsers),
      users: userPrivacy,
      sanitizedFields: SANITIZED_FIELDS,
    },
    skipped,
    collections,
  };

  await fsp.writeFile(
    path.join(outDir, MANIFEST_FILE),
    `${EJSON.stringify(manifest, null, 2, { relaxed: true })}\n`,
    'utf8',
  );

  return manifest;
}

async function readManifest(packageDir) {
  let raw;
  try {
    raw = await fsp.readFile(path.join(packageDir, MANIFEST_FILE), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new DatabaseDeliverableError(
        `${MANIFEST_FILE} not found in ${packageDir}`,
        'DB_DELIVERABLE_MANIFEST_MISSING',
      );
    }
    throw error;
  }

  const manifest = EJSON.parse(raw, { relaxed: true });
  if (manifest.tool !== PACKAGE_TOOL || manifest.formatVersion !== FORMAT_VERSION) {
    throw new DatabaseDeliverableError(
      `Unsupported package: tool=${manifest.tool}, formatVersion=${manifest.formatVersion}`,
      'DB_DELIVERABLE_FORMAT_UNSUPPORTED',
    );
  }
  return manifest;
}

async function verifyPackage(packageDir, manifest) {
  const problems = [];
  for (const entry of manifest.collections) {
    const filePath = path.resolve(packageDir, entry.file);
    const relative = path.relative(path.resolve(packageDir), filePath);
    // manifest 的路徑必須留在交付包內，避免被改成讀取任意檔案。
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      problems.push({ collection: entry.name, problem: 'path_outside_package' });
      continue;
    }
    try {
      const { sha256, bytes } = await hashFile(filePath);
      if (sha256 !== entry.sha256 || bytes !== entry.bytes) {
        problems.push({ collection: entry.name, problem: 'checksum_mismatch' });
      }
    } catch (error) {
      problems.push({
        collection: entry.name,
        problem: error.code === 'ENOENT' ? 'file_missing' : error.message,
      });
    }
  }
  return { ok: problems.length === 0, checked: manifest.collections.length, problems };
}

function toIndexSpecs(indexes = []) {
  return indexes
    .filter((index) => index.name !== '_id_')
    .map((index) => {
      const spec = { ...index };
      delete spec.v;
      delete spec.ns;
      return spec;
    });
}

async function* readDocumentBatches(filePath, batchSize = RESTORE_BATCH_SIZE) {
  const lines = readline.createInterface({
    input: fs.createReadStream(filePath).pipe(zlib.createGunzip()),
    crlfDelay: Infinity,
  });
  let batch = [];
  for await (const line of lines) {
    if (!line.trim()) continue;
    batch.push(fromEjsonLine(line));
    if (batch.length >= batchSize) {
      yield batch;
      batch = [];
    }
  }
  if (batch.length) yield batch;
}

async function restoreDatabase({
  db,
  packageDir,
  drop = false,
  skipSearchIndexes = false,
  log = () => {},
}) {
  const manifest = await readManifest(packageDir);
  const verification = await verifyPackage(packageDir, manifest);
  if (!verification.ok) {
    throw new DatabaseDeliverableError(
      `Package verification failed: ${JSON.stringify(verification.problems)}`,
      'DB_DELIVERABLE_VERIFY_FAILED',
    );
  }

  const existingNames = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((info) => info.name),
  );
  const conflicts = [];
  for (const entry of manifest.collections) {
    if (existingNames.has(entry.name) && (await db.collection(entry.name).countDocuments({})) > 0) {
      conflicts.push(entry.name);
    }
  }
  if (conflicts.length && !drop) {
    throw new DatabaseDeliverableError(
      `Target database already has data in: ${conflicts.join(', ')}. `
        + 'Restore into an empty database, or pass --drop to replace these collections.',
      'DB_DELIVERABLE_TARGET_NOT_EMPTY',
    );
  }

  const collections = [];
  for (const entry of manifest.collections) {
    if (existingNames.has(entry.name) && drop) {
      await db.collection(entry.name).drop();
      existingNames.delete(entry.name);
    }
    if (!existingNames.has(entry.name)) {
      await db.createCollection(entry.name, entry.options || {});
    }

    log(`Restoring ${entry.name} (${entry.count} documents)...`);
    const collection = db.collection(entry.name);
    for await (const batch of readDocumentBatches(path.resolve(packageDir, entry.file))) {
      await collection.insertMany(batch, { ordered: true });
    }

    const indexSpecs = toIndexSpecs(entry.indexes);
    if (indexSpecs.length) {
      await collection.createIndexes(indexSpecs);
    }

    const restored = await collection.countDocuments({});
    collections.push({
      name: entry.name,
      expected: entry.count,
      restored,
      indexesCreated: indexSpecs.length,
      ok: restored === entry.count,
    });
  }

  const searchIndexes = [];
  for (const entry of manifest.collections) {
    for (const index of entry.searchIndexes || []) {
      const result = { collection: entry.name, name: index.name, type: index.type };
      if (skipSearchIndexes) {
        searchIndexes.push({ ...result, status: 'skipped' });
        continue;
      }
      try {
        await db.command({
          createSearchIndexes: entry.name,
          indexes: [{ name: index.name, type: index.type, definition: index.definition }],
        });
        // Atlas 需要時間建索引，建立請求成功不代表已 READY。
        searchIndexes.push({ ...result, status: 'requested' });
      } catch (error) {
        searchIndexes.push({ ...result, status: 'failed', error: error.message || String(error) });
      }
    }
  }

  return {
    ok: collections.every((collection) => collection.ok),
    database: db.databaseName,
    sourceCreatedAt: manifest.createdAt,
    sourceGitCommit: manifest.gitCommit,
    collections,
    searchIndexes,
  };
}

module.exports = {
  DEFAULT_ALLOWED_EMAIL_DOMAINS,
  DEFAULT_EXCLUDED_COLLECTIONS,
  DatabaseDeliverableError,
  FORMAT_VERSION,
  MANIFEST_FILE,
  classifyUsers,
  exportDatabase,
  fromEjsonLine,
  readManifest,
  redactUri,
  restoreDatabase,
  sanitizeDocument,
  toEjsonLine,
  toIndexSpecs,
  verifyPackage,
};
