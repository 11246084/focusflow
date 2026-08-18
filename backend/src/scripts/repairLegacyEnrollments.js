const { MongoClient, ObjectId } = require('mongodb');
const env = require('../config/env');

function parseArgs(argv) {
  const args = {
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

  if (!ObjectId.isValid(args.courseId)) {
    throw new Error('--course-id must be a valid MongoDB ObjectId.');
  }
  if (args.apply && args.expectedCount === null) {
    throw new Error('--apply requires --expected-count from a fresh dry-run.');
  }

  return args;
}

function normalizeId(value) {
  return String(value?._id || value || '');
}

function maskEmail(email) {
  const [local = '', domain = ''] = String(email || '').split('@');
  if (!domain) return '<missing>';
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${'*'.repeat(Math.max(1, local.length - visible.length))}@${domain}`;
}

function buildRepairPlan({ course, historicalStudentIds, students, enrollments }) {
  if (!course) {
    throw new Error('Course not found.');
  }
  if (course.status !== 'published') {
    throw new Error('Course must be published before legacy access can be repaired.');
  }

  const historicalSet = new Set(historicalStudentIds.map(normalizeId));
  const existingByStudent = new Map(
    enrollments.map((enrollment) => [normalizeId(enrollment.studentId), enrollment]),
  );
  const eligibleStudents = students.filter((student) => (
    historicalSet.has(normalizeId(student._id))
    && student.role === 'student'
    && student.isActive !== false
  ));
  const candidates = eligibleStudents
    .filter((student) => !existingByStudent.has(normalizeId(student._id)))
    .map((student) => ({
      studentId: normalizeId(student._id),
      email: maskEmail(student.email),
    }))
    .sort((left, right) => left.studentId.localeCompare(right.studentId));

  return {
    course: {
      id: normalizeId(course._id),
      title: course.title,
      status: course.status,
    },
    historicalStudentCount: historicalSet.size,
    activeHistoricalStudentCount: eligibleStudents.length,
    existingEnrollmentCount: existingByStudent.size,
    revokedEnrollmentCount: enrollments.filter((item) => item.status === 'revoked').length,
    candidateCount: candidates.length,
    candidates,
  };
}

function buildRepairOperations(plan, now = new Date()) {
  return plan.candidates.map((candidate) => ({
    updateOne: {
      filter: {
        studentId: new ObjectId(candidate.studentId),
        courseId: new ObjectId(plan.course.id),
      },
      update: {
        $setOnInsert: {
          studentId: new ObjectId(candidate.studentId),
          courseId: new ObjectId(plan.course.id),
          status: 'active',
          assignedBy: null,
          enrolledAt: now,
          progress: 0,
          watchedVideoIds: [],
          lineNotify: false,
          createdAt: now,
          updatedAt: now,
        },
      },
      upsert: true,
    },
  }));
}

async function loadRepairPlan(db, courseId) {
  const objectId = new ObjectId(courseId);
  const course = await db.collection('courses').findOne(
    { _id: objectId },
    { projection: { title: 1, status: 1 } },
  );
  if (!course) {
    throw new Error('Course not found.');
  }

  const historicalStudentIds = await db.collection('questions').distinct('userId', {
    courseId: { $in: [objectId, courseId] },
  });
  const studentObjectIds = [...new Set(historicalStudentIds.map(normalizeId))]
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));
  const students = studentObjectIds.length
    ? await db.collection('users').find(
      { _id: { $in: studentObjectIds } },
      { projection: { email: 1, role: 1, isActive: 1 } },
    ).toArray()
    : [];
  const enrollments = studentObjectIds.length
    ? await db.collection('enrollments').find({
      courseId: { $in: [objectId, courseId] },
      studentId: { $in: studentObjectIds },
    }).toArray()
    : [];

  return buildRepairPlan({
    course,
    historicalStudentIds,
    students,
    enrollments,
  });
}

async function applyRepair(db, plan, expectedCount) {
  if (plan.candidateCount !== expectedCount) {
    throw new Error(
      `Candidate count changed: expected ${expectedCount}, found ${plan.candidateCount}. Run dry-run again.`,
    );
  }

  const operations = buildRepairOperations(plan);
  if (!operations.length) {
    return { matched: 0, modified: 0, upserted: 0, verifiedActive: 0 };
  }

  const result = await db.collection('enrollments').bulkWrite(operations, { ordered: true });
  const verifiedActive = await db.collection('enrollments').countDocuments({
    courseId: new ObjectId(plan.course.id),
    studentId: { $in: plan.candidates.map((item) => new ObjectId(item.studentId)) },
    status: 'active',
  });

  if (verifiedActive !== plan.candidateCount) {
    throw new Error(
      `Post-write verification failed: expected ${plan.candidateCount} active enrollments, found ${verifiedActive}.`,
    );
  }

  return {
    matched: result.matchedCount || 0,
    modified: result.modifiedCount || 0,
    upserted: result.upsertedCount || 0,
    verifiedActive,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const client = new MongoClient(env.mongodbUri, {
    connectTimeoutMS: 15000,
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 1,
  });

  try {
    await client.connect();
    const db = client.db();
    const plan = await loadRepairPlan(db, args.courseId);
    const result = args.apply
      ? await applyRepair(db, plan, args.expectedCount)
      : null;

    console.log(JSON.stringify({
      database: db.databaseName,
      mode: args.apply ? 'apply' : 'dry-run',
      rule: 'published course + historical question + active student + no existing enrollment',
      plan,
      result,
    }, null, 2));
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('repairLegacyEnrollments failed:', error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  applyRepair,
  buildRepairOperations,
  buildRepairPlan,
  loadRepairPlan,
  maskEmail,
  parseArgs,
};
