const dns = require('node:dns');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const { MongoClient, ObjectId } = require('mongodb');
const env = require('../config/env');

// Imports a class roster (CSV) as student accounts: email is the login, the
// student number is the initial password. Dry-run by default; existing emails
// are never overwritten so a re-run cannot reset a password or change a role.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const HEADER_ALIASES = {
  name: ['name', '姓名'],
  email: ['email', 'e-mail', 'mail', '信箱', '電子郵件'],
  studentId: ['studentid', 'student_id', '學號'],
};

function parseArgs(argv) {
  const args = {
    file: '',
    apply: false,
    courseId: '',
    expectedCount: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--apply') {
      args.apply = true;
      continue;
    }
    if (token === '--file') {
      args.file = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--course-id') {
      args.courseId = String(argv[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token === '--expected-count') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 0) {
        throw new Error('--expected-count must be a non-negative integer.');
      }
      args.expectedCount = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }

  if (!args.file) {
    throw new Error('--file <roster.csv> is required.');
  }
  if (args.courseId && !ObjectId.isValid(args.courseId)) {
    throw new Error('--course-id must be a valid MongoDB ObjectId.');
  }
  if (args.apply && args.expectedCount === null) {
    throw new Error('--apply requires --expected-count from a fresh dry-run.');
  }

  return args;
}

// Minimal RFC 4180 parser: quoted fields, escaped quotes, CRLF, Excel's UTF-8 BOM.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const raw = String(text);
  const source = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

function resolveColumns(headerRow) {
  const normalized = headerRow.map((cell) => cell.trim().toLowerCase());
  const columns = {};
  for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
    const position = normalized.findIndex((cell) => aliases.includes(cell));
    if (position === -1) {
      throw new Error(`CSV header must include a ${key} column (accepted: ${aliases.join(', ')}).`);
    }
    columns[key] = position;
  }
  return columns;
}

function maskEmail(email) {
  const [local = '', domain = ''] = String(email || '').split('@');
  if (!domain) return '<missing>';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

function buildImportPlan({ rows, existingUsers }) {
  if (!rows.length) {
    throw new Error('CSV is empty.');
  }
  const columns = resolveColumns(rows[0]);
  const existingByEmail = new Map(existingUsers.map((user) => [user.email, user]));
  const seenEmails = new Set();
  const creates = [];
  const existing = [];
  const invalid = [];

  rows.slice(1).forEach((cells, offset) => {
    const line = offset + 2;
    const name = String(cells[columns.name] || '').trim();
    const email = String(cells[columns.email] || '').trim().toLowerCase();
    const studentId = String(cells[columns.studentId] || '').trim();

    if (!name) return invalid.push({ line, reason: 'name is empty' });
    if (!EMAIL_REGEX.test(email)) return invalid.push({ line, reason: 'email is invalid' });
    if (studentId.length < MIN_PASSWORD_LENGTH) {
      return invalid.push({ line, reason: `student number shorter than ${MIN_PASSWORD_LENGTH} characters` });
    }
    if (seenEmails.has(email)) return invalid.push({ line, reason: 'duplicate email in CSV' });
    seenEmails.add(email);

    const user = existingByEmail.get(email);
    if (user) {
      existing.push({
        line,
        userId: String(user._id),
        email,
        role: user.role,
        isActive: user.isActive !== false,
      });
      return undefined;
    }
    creates.push({ line, name, email, studentId });
    return undefined;
  });

  return { creates, existing, invalid };
}

// Enroll new accounts plus existing active students; teachers/admins that share an email are left alone.
function selectEnrollmentTargets(plan, createdIds) {
  return [
    ...createdIds,
    ...plan.existing
      .filter((user) => user.role === 'student' && user.isActive)
      .map((user) => user.userId),
  ];
}

function summarizePlan(plan) {
  return {
    createCount: plan.creates.length,
    existingCount: plan.existing.length,
    invalidCount: plan.invalid.length,
    creates: plan.creates.map((item) => ({ line: item.line, name: item.name, email: maskEmail(item.email) })),
    existing: plan.existing.map((item) => ({
      line: item.line,
      email: maskEmail(item.email),
      role: item.role,
      isActive: item.isActive,
    })),
    invalid: plan.invalid,
  };
}

async function applyImport(db, plan, { expectedCount, courseId, now = new Date() }) {
  if (plan.creates.length !== expectedCount) {
    throw new Error(
      `Create count changed: expected ${expectedCount}, found ${plan.creates.length}. Run dry-run again.`,
    );
  }

  const documents = await Promise.all(plan.creates.map(async (item) => ({
    name: item.name,
    email: item.email,
    passwordHash: await bcrypt.hash(item.studentId, 10),
    role: 'student',
    isActive: true,
    avatar: null,
    lineBindAt: null,
    activeCourseId: null,
    lineConversationState: 'idle',
    lineConversationHistory: [],
    createdAt: now,
    updatedAt: now,
  })));

  const createdIds = [];
  if (documents.length) {
    const result = await db.collection('users').insertMany(documents, { ordered: true });
    createdIds.push(...Object.values(result.insertedIds).map(String));
  }

  let enrolled = 0;
  if (courseId) {
    const course = new ObjectId(courseId);
    const targets = selectEnrollmentTargets(plan, createdIds);
    if (targets.length) {
      // Same semantics as enrollment.service assignStudent: upsert and reactivate revoked rows.
      const result = await db.collection('enrollments').bulkWrite(targets.map((studentId) => ({
        updateOne: {
          filter: { studentId: new ObjectId(studentId), courseId: course },
          update: {
            $set: { status: 'active', assignedBy: null, enrolledAt: now, updatedAt: now },
            $unset: { revokedAt: 1, revokedBy: 1 },
            $setOnInsert: {
              studentId: new ObjectId(studentId),
              courseId: course,
              progress: 0,
              watchedVideoIds: [],
              lineNotify: false,
              createdAt: now,
            },
          },
          upsert: true,
        },
      })), { ordered: true });
      enrolled = (result.upsertedCount || 0) + (result.modifiedCount || 0);
    }
  }

  return { created: createdIds.length, enrolled };
}

async function main() {
  // Same workaround as server.js: some networks refuse Node's SRV lookup for mongodb+srv URIs.
  dns.setServers(['8.8.8.8', '8.8.4.4']);
  const args = parseArgs(process.argv.slice(2));
  const rows = parseCsv(fs.readFileSync(args.file, 'utf8'));
  const client = new MongoClient(env.mongodbUri, {
    connectTimeoutMS: 15000,
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 1,
  });

  try {
    await client.connect();
    const db = client.db();

    let course = null;
    if (args.courseId) {
      course = await db.collection('courses').findOne(
        { _id: new ObjectId(args.courseId) },
        { projection: { title: 1, status: 1 } },
      );
      if (!course) throw new Error('Course not found.');
    }

    const { email: emailColumn } = resolveColumns(rows[0] || []);
    const emails = rows.slice(1).map((cells) => String(cells[emailColumn] || '').trim().toLowerCase());
    const existingUsers = await db.collection('users').find(
      { email: { $in: emails.filter(Boolean) } },
      { projection: { email: 1, role: 1, isActive: 1 } },
    ).toArray();

    const plan = buildImportPlan({ rows, existingUsers });
    const result = args.apply
      ? await applyImport(db, plan, { expectedCount: args.expectedCount, courseId: args.courseId })
      : null;

    console.log(JSON.stringify({
      database: db.databaseName,
      mode: args.apply ? 'apply' : 'dry-run',
      course: course ? { id: String(course._id), title: course.title, status: course.status } : null,
      plan: summarizePlan(plan),
      result,
    }, null, 2));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('importStudents failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  applyImport,
  buildImportPlan,
  parseArgs,
  parseCsv,
  selectEnrollmentTargets,
};
