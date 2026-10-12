const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { describe, it, beforeEach, afterEach } = require('node:test');
const { BSON } = require('mongodb');
const {
  DatabaseDeliverableError,
  MANIFEST_FILE,
  classifyUsers,
  exportDatabase,
  fromEjsonLine,
  readManifest,
  restoreDatabase,
  sanitizeDocument,
  toEjsonLine,
  toIndexSpecs,
  verifyPackage,
} = require('../src/services/databaseDeliverable.service');
const exportCli = require('../src/scripts/exportDatabaseDeliverable');
const restoreCli = require('../src/scripts/restoreDatabaseDeliverable');

const { Binary, Double, Int32, ObjectId } = BSON;

// 只實作匯出／還原會用到的 driver 介面；以 EJSON 深拷貝模擬 BSON 寫入與讀出。
function cloneBson(value) {
  return BSON.deserialize(BSON.serialize({ value }), { promoteValues: false }).value;
}

function createFakeDb(databaseName, initial = {}, { searchIndexes = {}, supportsSearch = true } = {}) {
  const store = new Map();
  const commands = [];

  const ensure = (name, options = {}) => {
    if (!store.has(name)) {
      store.set(name, { docs: [], options, indexes: [{ v: 2, key: { _id: 1 }, name: '_id_' }] });
    }
    return store.get(name);
  };

  for (const [name, { docs = [], indexes = [], options = {} }] of Object.entries(initial)) {
    const entry = ensure(name, options);
    entry.docs.push(...docs.map(cloneBson));
    entry.indexes.push(...indexes);
  }

  const collection = (name) => ({
    find(filter = {}, options = {}) {
      const docs = [...(store.get(name)?.docs || [])].map(cloneBson);
      const projected = options.projection
        ? docs.map((doc) => Object.fromEntries(
          Object.keys(options.projection).filter((key) => key in doc).map((key) => [key, doc[key]]),
        ))
        : docs;
      return {
        toArray: async () => projected,
        async* [Symbol.asyncIterator]() { yield* projected; },
      };
    },
    async indexes() { return structuredClone(store.get(name)?.indexes || []); },
    aggregate() {
      return {
        toArray: async () => {
          if (!supportsSearch) throw new Error('$listSearchIndexes stage is only allowed on MongoDB Atlas');
          return (searchIndexes[name] || []).map((index) => ({ ...index, status: 'READY' }));
        },
      };
    },
    async insertMany(docs) { ensure(name).docs.push(...docs.map(cloneBson)); },
    async createIndexes(specs) { ensure(name).indexes.push(...specs.map((spec) => ({ v: 2, ...spec }))); },
    async countDocuments() { return store.get(name)?.docs.length || 0; },
    async drop() { store.delete(name); },
  });

  return {
    databaseName,
    store,
    commands,
    listCollections() {
      return {
        toArray: async () => [...store.entries()].map(([name, entry]) => ({
          name,
          type: 'collection',
          options: entry.options,
        })),
      };
    },
    collection,
    async createCollection(name, options) { ensure(name, options); },
    async command(command) {
      if (!supportsSearch) throw new Error('createSearchIndexes is only supported on Atlas');
      commands.push(command);
      return { ok: 1 };
    },
  };
}

const demoUserId = new ObjectId('680000000000000000000001');
const embedding = [new Double(1), new Double(0.25), new Double(-0.5)];

function demoSource(overrides = {}) {
  return createFakeDb('focusflow_demo', {
    users: {
      docs: [{
        _id: demoUserId,
        email: 'student@focusflow.local',
        passwordHash: '$2a$10$hash',
        passwordReset: { codeHash: 'secret', expiresAt: new Date('2026-10-01T00:00:00Z') },
        createdAt: new Date('2026-09-01T00:00:00Z'),
      }],
      indexes: [{ v: 2, key: { email: 1 }, name: 'email_1', unique: true }],
    },
    video_segments_text: {
      docs: [{
        _id: new ObjectId('680000000000000000000301'),
        videoId: '680000000000000000000201',
        startSec: new Int32(12),
        embedding,
        thumbnail: new Binary(Buffer.from([1, 2, 3])),
      }],
    },
    line_bind_tokens: { docs: [{ _id: new ObjectId(), token: 'one-time' }] },
    ...overrides,
  }, {
    searchIndexes: {
      video_segments_text: [{
        name: 'text_embedding_index',
        type: 'vectorSearch',
        latestDefinition: { fields: [{ type: 'vector', path: 'embedding', numDimensions: 3072, similarity: 'cosine' }] },
      }],
    },
  });
}

describe('databaseDeliverable 純函式', () => {
  it('canonical EJSON 來回轉換保留 Double／Int32／ObjectId／Date 型別', () => {
    const parsed = fromEjsonLine(toEjsonLine({
      a: new Double(1),
      b: new Int32(2),
      id: demoUserId,
      at: new Date('2026-10-07T00:00:00Z'),
    }));

    assert.equal(parsed.a instanceof Double, true);
    assert.equal(parsed.b instanceof Int32, true);
    assert.equal(parsed.id.equals(demoUserId), true);
    assert.equal(parsed.at.toISOString(), '2026-10-07T00:00:00.000Z');
  });

  it('users 匯出時移除 passwordReset，其他 collection 不動', () => {
    const user = { _id: 1, email: 'a@focusflow.local', passwordReset: { codeHash: 'x' } };
    assert.equal('passwordReset' in sanitizeDocument('users', user), false);
    assert.equal('passwordReset' in user, true);
    assert.equal(sanitizeDocument('questions', user), user);
  });

  it('非 demo 網域或已綁 LINE 的帳號會被算成需要去識別化', () => {
    const summary = classifyUsers([
      { email: 'student@focusflow.local' },
      { email: '11246084@ntub.edu.tw' },
      { email: 'teacher@focusflow.local', lineUserId: 'U123' },
    ]);
    assert.deepEqual(summary, { total: 3, nonDemoEmail: 1, lineBound: 1, unsafe: 2 });
  });

  it('還原索引規格略過 _id_ 並移除 v／ns', () => {
    const specs = toIndexSpecs([
      { v: 2, key: { _id: 1 }, name: '_id_' },
      { v: 2, key: { email: 1 }, name: 'email_1', unique: true, ns: 'focusflow.users' },
    ]);
    assert.deepEqual(specs, [{ key: { email: 1 }, name: 'email_1', unique: true }]);
  });
});

describe('databaseDeliverable 匯出與還原', () => {
  let workDir;

  beforeEach(async () => {
    workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'focusflow-db-deliverable-'));
  });

  afterEach(async () => {
    await fsp.rm(workDir, { recursive: true, force: true });
  });

  it('匯出產生 manifest、排除 line_bind_tokens 並記錄向量索引定義', async () => {
    const outDir = path.join(workDir, 'pkg');
    const manifest = await exportDatabase({ db: demoSource(), outDir, source: { uri: 'mongodb+srv://u:p@x/focusflow_demo' } });

    assert.deepEqual(manifest.collections.map((entry) => entry.name), ['users', 'video_segments_text']);
    assert.deepEqual(manifest.skipped, [{ name: 'line_bind_tokens', reason: 'excluded' }]);
    assert.equal(manifest.source.uri, 'mongodb+srv://u:***@x/focusflow_demo');
    assert.equal(manifest.collections[1].searchIndexes[0].definition.fields[0].numDimensions, 3072);

    const onDisk = await readManifest(outDir);
    assert.equal(onDisk.collections[0].count, 1);
    assert.equal((await verifyPackage(outDir, onDisk)).ok, true);
  });

  it('來源含真實學生帳號時拒絕匯出', async () => {
    const db = demoSource({
      users: { docs: [{ _id: new ObjectId(), email: 'real@ntub.edu.tw', passwordHash: 'x' }] },
    });

    await assert.rejects(
      exportDatabase({ db, outDir: path.join(workDir, 'pkg') }),
      (error) => error instanceof DatabaseDeliverableError && error.code === 'DB_DELIVERABLE_REAL_USERS_FOUND',
    );
  });

  it('輸出目錄非空時拒絕覆寫', async () => {
    const outDir = path.join(workDir, 'pkg');
    await fsp.mkdir(outDir);
    await fsp.writeFile(path.join(outDir, 'old.txt'), 'x');

    await assert.rejects(
      exportDatabase({ db: demoSource(), outDir }),
      (error) => error.code === 'DB_DELIVERABLE_OUTPUT_NOT_EMPTY',
    );
  });

  it('還原到空資料庫後資料型別、索引與向量索引請求一致', async () => {
    const outDir = path.join(workDir, 'pkg');
    await exportDatabase({ db: demoSource(), outDir });
    const target = createFakeDb('focusflow');

    const report = await restoreDatabase({ db: target, packageDir: outDir });

    assert.equal(report.ok, true);
    const [user] = target.store.get('users').docs;
    assert.equal(user._id.equals(demoUserId), true);
    assert.equal(user.createdAt instanceof Date, true);
    assert.equal('passwordReset' in user, false);
    assert.equal(target.store.get('users').indexes.some((index) => index.name === 'email_1' && index.unique), true);

    const [segment] = target.store.get('video_segments_text').docs;
    assert.equal(segment.embedding[0] instanceof Double, true);
    assert.equal(segment.startSec instanceof Int32, true);
    assert.deepEqual([...segment.thumbnail.buffer], [1, 2, 3]);

    assert.deepEqual(report.searchIndexes, [{
      collection: 'video_segments_text', name: 'text_embedding_index', type: 'vectorSearch', status: 'requested',
    }]);
    assert.equal(target.commands[0].createSearchIndexes, 'video_segments_text');
    assert.equal(target.store.has('line_bind_tokens'), false);
  });

  it('目標已有資料且未加 --drop 時拒絕還原', async () => {
    const outDir = path.join(workDir, 'pkg');
    await exportDatabase({ db: demoSource(), outDir });

    await assert.rejects(
      restoreDatabase({ db: demoSource(), packageDir: outDir }),
      (error) => error.code === 'DB_DELIVERABLE_TARGET_NOT_EMPTY',
    );
  });

  it('加 --drop 時取代既有 collection，不重複寫入', async () => {
    const outDir = path.join(workDir, 'pkg');
    await exportDatabase({ db: demoSource(), outDir });
    const target = demoSource();

    const report = await restoreDatabase({ db: target, packageDir: outDir, drop: true });

    assert.equal(report.ok, true);
    assert.equal(target.store.get('users').docs.length, 1);
  });

  it('非 Atlas 目標建立向量索引失敗時只回報，不中斷資料還原', async () => {
    const outDir = path.join(workDir, 'pkg');
    await exportDatabase({ db: demoSource(), outDir });
    const target = createFakeDb('focusflow', {}, { supportsSearch: false });

    const report = await restoreDatabase({ db: target, packageDir: outDir });

    assert.equal(report.ok, true);
    assert.equal(report.searchIndexes[0].status, 'failed');
  });

  it('資料檔被改動時 checksum 驗證失敗並拒絕還原', async () => {
    const outDir = path.join(workDir, 'pkg');
    await exportDatabase({ db: demoSource(), outDir });
    await fsp.appendFile(path.join(outDir, 'collections', 'users.ejson.gz'), 'tampered');

    await assert.rejects(
      restoreDatabase({ db: createFakeDb('focusflow'), packageDir: outDir }),
      (error) => error.code === 'DB_DELIVERABLE_VERIFY_FAILED',
    );
  });

  it('manifest 指向交付包外的檔案時驗證失敗', async () => {
    const outDir = path.join(workDir, 'pkg');
    await exportDatabase({ db: demoSource(), outDir });
    const manifest = await readManifest(outDir);
    manifest.collections[0].file = '../outside.ejson.gz';

    const result = await verifyPackage(outDir, manifest);

    assert.equal(result.ok, false);
    assert.equal(result.problems[0].problem, 'path_outside_package');
  });

  it('缺 manifest 時回報 DB_DELIVERABLE_MANIFEST_MISSING', async () => {
    await assert.rejects(
      readManifest(workDir),
      (error) => error.code === 'DB_DELIVERABLE_MANIFEST_MISSING',
    );
    assert.equal(MANIFEST_FILE, 'manifest.json');
  });
});

describe('databaseDeliverable CLI 參數', () => {
  it('匯出預設排除 line_bind_tokens，--exclude 會累加', () => {
    const options = exportCli.parseCliArgs(['--exclude', 'faqs,usage_logs', '--out', 'pkg']);
    assert.deepEqual(options.excludeCollections, ['line_bind_tokens', 'faqs', 'usage_logs']);
    assert.equal(options.outDir, path.resolve('pkg'));
    assert.equal(options.allowRealUsers, false);
  });

  it('還原未加 --verify-only 時必須指定 --target-db', () => {
    assert.throws(() => restoreCli.parseCliArgs(['--from', 'pkg']), (error) => error.code === 'DB_DELIVERABLE_CLI_INVALID');
    assert.equal(restoreCli.parseCliArgs(['--from', 'pkg', '--verify-only']).verifyOnly, true);
  });

  it('未知參數直接報錯', () => {
    assert.throws(() => restoreCli.parseCliArgs(['--from', 'pkg', '--force']), /Unknown argument/);
  });
});
