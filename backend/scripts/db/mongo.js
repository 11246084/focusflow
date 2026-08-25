#!/usr/bin/env node
/**
 * FocusFlow MongoDB 連線／查詢工具。
 *
 * 使用 backend/.env 的 MONGODB_URI 連線，提供實查 collection、索引、
 * Atlas Search / Vector index 狀態的子指令。
 *
 * 預設唯讀：eval 子指令會擋掉寫入操作，除非明確加上 --allow-write。
 *
 * 用法（於 backend/ 下）：
 *   node scripts/db/mongo.js ping
 *   node scripts/db/mongo.js collections
 *   node scripts/db/mongo.js count <collection> [filterJson]
 *   node scripts/db/mongo.js find <collection> [filterJson] [limit]
 *   node scripts/db/mongo.js indexes <collection>
 *   node scripts/db/mongo.js search-indexes [collection]
 *   node scripts/db/mongo.js sample <collection>
 *   node scripts/db/mongo.js eval "<javascript>" [--allow-write]
 *
 * 範例：
 *   node scripts/db/mongo.js count faqs '{"courseId":{"$oid":"6a6da68456dd124511ec5196"}}'
 *   node scripts/db/mongo.js find courses '{"status":"published"}' 5
 *   node scripts/db/mongo.js search-indexes video_segments_text
 *   node scripts/db/mongo.js eval "await db.collection('videos').countDocuments({})"
 */

const path = require('path');

// 用絕對路徑讀 backend/.env，這樣從任何目錄執行都可以，不必先 cd backend。
const ENV_PATH = path.join(__dirname, '..', '..', '.env');
require('dotenv').config({ path: ENV_PATH });

const dns = require('dns');
const fs = require('fs');
const mongoose = require('mongoose');

const MASK = /:\/\/([^:]+):([^@]+)@/;

// embedding 動輒 3072 維，印出來會洗版；預設一律隱藏。
const HEAVY_FIELDS = ['embedding', 'vector', 'queryVector'];

function maskUri(uri) {
  return String(uri || '').replace(MASK, '://$1:***@');
}

// 支援在 filter JSON 裡用 {"$oid":"..."} 與 {"$date":"..."} 表示型別。
function reviveExtendedJson(value) {
  if (Array.isArray(value)) {
    return value.map(reviveExtendedJson);
  }

  if (value && typeof value === 'object') {
    const keys = Object.keys(value);

    if (keys.length === 1 && keys[0] === '$oid') {
      return new mongoose.Types.ObjectId(value.$oid);
    }
    if (keys.length === 1 && keys[0] === '$date') {
      return new Date(value.$date);
    }

    return Object.fromEntries(keys.map((k) => [k, reviveExtendedJson(value[k])]));
  }

  return value;
}

function parseFilter(raw, label = 'filter') {
  if (!raw) return {};
  try {
    return reviveExtendedJson(JSON.parse(raw));
  } catch (err) {
    throw new Error(`${label} 不是合法的 JSON：${err.message}\n收到：${raw}`);
  }
}

function stripHeavy(doc) {
  if (Array.isArray(doc)) return doc.map(stripHeavy);
  if (!doc || typeof doc !== 'object' || doc instanceof Date) return doc;
  if (doc instanceof mongoose.Types.ObjectId) return String(doc);

  const out = {};
  for (const [k, v] of Object.entries(doc)) {
    if (HEAVY_FIELDS.includes(k)) {
      out[k] = Array.isArray(v) ? `<${v.length} 維向量，已省略>` : '<已省略>';
    } else {
      out[k] = stripHeavy(v);
    }
  }
  return out;
}

function print(value) {
  console.log(JSON.stringify(stripHeavy(value), null, 2));
}

const WRITE_OPS = /\b(insert|update|delete|replace|drop|rename|createIndex|dropIndex|bulkWrite|findOneAnd)/i;

// 連線前就先擋，避免明知要拒絕還開一條 DB 連線。
function assertEvalAllowed(args) {
  const allowWrite = args.includes('--allow-write');
  const code = args.filter((a) => a !== '--allow-write').join(' ');

  if (!code) throw new Error('用法：eval "<javascript>" [--allow-write]');

  if (!allowWrite && WRITE_OPS.test(code)) {
    throw new Error(
      '這段程式碼看起來包含寫入操作，預設被擋下。\n'
      + '確認要執行請加上 --allow-write，並先確認你連的是哪個資料庫。',
    );
  }

  return code;
}

const COMMANDS = {
  async ping(db) {
    const admin = db.admin();
    const info = await admin.serverStatus().catch(() => null);
    const stats = await db.stats();
    print({
      database: db.databaseName,
      host: info?.host || '(無權限讀取 serverStatus)',
      version: info?.version || '(無權限讀取 serverStatus)',
      collections: stats.collections,
      objects: stats.objects,
      dataSizeMB: Number((stats.dataSize / 1024 / 1024).toFixed(2)),
    });
  },

  async collections(db) {
    const list = await db.listCollections().toArray();
    const rows = [];
    for (const c of list) {
      rows.push({ name: c.name, count: await db.collection(c.name).estimatedDocumentCount() });
    }
    rows.sort((a, b) => b.count - a.count);
    const width = Math.max(...rows.map((r) => r.name.length));
    for (const r of rows) {
      console.log(`${r.name.padEnd(width)}  ${String(r.count).padStart(8)}`);
    }
    console.log(`\n共 ${rows.length} 個 collection。`);
  },

  async count(db, [name, filter]) {
    if (!name) throw new Error('用法：count <collection> [filterJson]');
    const n = await db.collection(name).countDocuments(parseFilter(filter));
    console.log(n);
  },

  async find(db, [name, filter, limit]) {
    if (!name) throw new Error('用法：find <collection> [filterJson] [limit]');
    const docs = await db.collection(name)
      .find(parseFilter(filter))
      .limit(Number(limit) || 5)
      .toArray();
    print(docs);
    console.error(`\n(${docs.length} 筆；embedding 等大型欄位已省略)`);
  },

  async sample(db, [name]) {
    if (!name) throw new Error('用法：sample <collection>');
    const [doc] = await db.collection(name).aggregate([{ $sample: { size: 1 } }]).toArray();
    if (!doc) return console.log('(collection 是空的)');
    print(doc);
    console.error(`\n欄位：${Object.keys(doc).join(', ')}`);
  },

  async indexes(db, [name]) {
    if (!name) throw new Error('用法：indexes <collection>');
    print(await db.collection(name).indexes());
  },

  // CLAUDE.md 明確要求 Atlas vector index 狀態「以實查為準」，不要憑文件斷言。
  async 'search-indexes'(db, [name]) {
    const names = name
      ? [name]
      : (await db.listCollections().toArray()).map((c) => c.name);

    let found = 0;
    for (const c of names) {
      let list;
      try {
        list = await db.collection(c).listSearchIndexes().toArray();
      } catch (err) {
        if (!name) continue;            // 掃描模式：略過不支援的 collection
        throw err;
      }
      if (!list.length) continue;
      found += list.length;
      console.log(`\n=== ${c} ===`);
      for (const idx of list) {
        console.log(`  ${idx.name}  type=${idx.type || 'search'}  status=${idx.status}`
          + `  queryable=${idx.queryable}`);
        const field = idx.latestDefinition?.fields?.[0];
        if (field) {
          console.log(`    path=${field.path} dims=${field.numDimensions} similarity=${field.similarity}`);
        }
      }
    }
    if (!found) {
      console.log('沒有找到任何 Atlas Search / Vector index。');
      console.log('注意：本機 mongod 不支援 Atlas Search，這個結果只在連 Atlas 時有意義。');
    }
  },

  async eval(db, args) {
    const code = assertEvalAllowed(args);

    // eslint-disable-next-line no-new-func
    const fn = new Function('db', 'mongoose', 'ObjectId', `return (async () => { ${
      code.includes('return') ? code : `return ${code};`
    } })();`);
    print(await fn(db, mongoose, mongoose.Types.ObjectId));
  },
};

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(require('fs').readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n/, ''));
    return;
  }

  const handler = COMMANDS[cmd];
  if (!handler) {
    throw new Error(`未知的指令：${cmd}\n可用：${Object.keys(COMMANDS).join(', ')}`);
  }

  // eval 的安全檢查提前到連線之前，避免白開一條連線。
  if (cmd === 'eval') assertEvalAllowed(args);

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      fs.existsSync(ENV_PATH)
        ? `找到 ${ENV_PATH}，但裡面沒有 MONGODB_URI。`
        : `找不到 ${ENV_PATH}。\n`
          + '.env 不進版控，需要自己建立：\n'
          + '  Copy-Item .env.example .env\n'
          + '然後填入 MONGODB_URI（向專案負責人索取，或用自己的 Atlas 帳號）。',
    );
  }

  console.error(`連線中：${maskUri(uri)}`);
  mongoose.set('strictQuery', true);

  // mongodb+srv 需要 DNS SRV 查詢，校網／VPN／某些 ISP 會擋。
  // 失敗時改用公用 DNS 重試一次；可用 MONGO_DNS_SERVERS 覆寫（逗號分隔）。
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  } catch (err) {
    const dnsIssue = /querySrv|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/.test(err.message);
    if (!dnsIssue || !uri.startsWith('mongodb+srv://')) throw err;

    const fallback = (process.env.MONGO_DNS_SERVERS || '1.1.1.1,8.8.8.8')
      .split(',').map((s) => s.trim()).filter(Boolean);

    console.error(`SRV 查詢失敗，改用公用 DNS 重試：${fallback.join(', ')}`);
    dns.setServers(fallback);
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 20000 });
    console.error('（靠公用 DNS 才連上——代表你的預設 DNS 擋了 SRV 查詢）');
  }

  console.error('已連線。\n');

  try {
    await handler(mongoose.connection.db, args);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(`\n錯誤：${err.message}`);
  if (/querySrv|ENOTFOUND|ECONNREFUSED/.test(err.message)) {
    console.error(
      '\n這是 DNS/網路層的問題，不是帳密錯誤。可能原因：\n'
      + '  - mongodb+srv 需要解析 SRV 記錄，某些網路（校網、VPN、防火牆）會擋\n'
      + '  - 你的 IP 不在 Atlas 的 Network Access 允許清單裡\n'
      + '  - 改用非 SRV 的 mongodb:// 直連字串通常可以繞過 SRV 限制',
    );
  }
  process.exit(1);
});
