const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { ObjectId } = require('mongodb');
const {
  applyRepair,
  buildRepairOperations,
  buildRepairPlan,
  maskEmail,
  parseArgs,
} = require('../src/scripts/repairLegacyEnrollments');

const courseId = '69f82564736febac6db8e97b';
const firstStudentId = '69f82564736febac6db8e971';
const secondStudentId = '69f82564736febac6db8e972';

function course(overrides = {}) {
  return {
    _id: new ObjectId(courseId),
    title: '影像處理導論',
    status: 'published',
    ...overrides,
  };
}

function student(id, overrides = {}) {
  return {
    _id: new ObjectId(id),
    email: `${id.slice(-2)}@example.com`,
    role: 'student',
    isActive: true,
    ...overrides,
  };
}

describe('legacy Enrollment repair', () => {
  it('defaults to dry-run and requires an expected candidate count before apply', () => {
    assert.deepEqual(parseArgs(['--course-id', courseId]), {
      apply: false,
      courseId,
      expectedCount: null,
    });
    assert.throws(
      () => parseArgs(['--course-id', courseId, '--apply']),
      /requires --expected-count/,
    );
    assert.deepEqual(
      parseArgs(['--course-id', courseId, '--apply', '--expected-count', '2']),
      { apply: true, courseId, expectedCount: 2 },
    );
  });

  it('only proposes active historical students with no Enrollment relationship', () => {
    const plan = buildRepairPlan({
      course: course(),
      historicalStudentIds: [new ObjectId(firstStudentId), new ObjectId(secondStudentId)],
      students: [student(firstStudentId), student(secondStudentId)],
      enrollments: [{
        studentId: new ObjectId(secondStudentId),
        courseId: new ObjectId(courseId),
        status: 'revoked',
      }],
    });

    assert.equal(plan.historicalStudentCount, 2);
    assert.equal(plan.revokedEnrollmentCount, 1);
    assert.equal(plan.candidateCount, 1);
    assert.equal(plan.candidates[0].studentId, firstStudentId);
  });

  it('does not rewrite legacy rows whose status is missing', () => {
    const plan = buildRepairPlan({
      course: course(),
      historicalStudentIds: [new ObjectId(firstStudentId)],
      students: [student(firstStudentId)],
      enrollments: [{
        studentId: new ObjectId(firstStudentId),
        courseId: new ObjectId(courseId),
      }],
    });

    assert.equal(plan.existingEnrollmentCount, 1);
    assert.equal(plan.candidateCount, 0);
  });

  it('rejects draft courses and inactive or non-student users', () => {
    assert.throws(() => buildRepairPlan({
      course: course({ status: 'draft' }),
      historicalStudentIds: [],
      students: [],
      enrollments: [],
    }), /must be published/);

    const plan = buildRepairPlan({
      course: course(),
      historicalStudentIds: [new ObjectId(firstStudentId), new ObjectId(secondStudentId)],
      students: [
        student(firstStudentId, { isActive: false }),
        student(secondStudentId, { role: 'teacher' }),
      ],
      enrollments: [],
    });
    assert.equal(plan.candidateCount, 0);
  });

  it('uses insert-only upserts with active Enrollment defaults', () => {
    const now = new Date('2026-08-17T13:00:00.000Z');
    const plan = buildRepairPlan({
      course: course(),
      historicalStudentIds: [new ObjectId(firstStudentId)],
      students: [student(firstStudentId)],
      enrollments: [],
    });
    const [operation] = buildRepairOperations(plan, now);

    assert.deepEqual(operation.updateOne.filter, {
      studentId: new ObjectId(firstStudentId),
      courseId: new ObjectId(courseId),
    });
    assert.equal(operation.updateOne.upsert, true);
    assert.equal(operation.updateOne.update.$setOnInsert.status, 'active');
    assert.equal(operation.updateOne.update.$setOnInsert.progress, 0);
    assert.deepEqual(operation.updateOne.update.$setOnInsert.watchedVideoIds, []);
    assert.equal(operation.updateOne.update.$set, undefined);
  });

  it('refuses to write when the candidate count changed after dry-run', async () => {
    const plan = buildRepairPlan({
      course: course(),
      historicalStudentIds: [new ObjectId(firstStudentId)],
      students: [student(firstStudentId)],
      enrollments: [],
    });
    const db = {
      collection() {
        throw new Error('database must not be reached');
      },
    };

    await assert.rejects(() => applyRepair(db, plan, 2), /Candidate count changed/);
  });

  it('masks student email addresses in operational output', () => {
    assert.equal(maskEmail('student@example.com'), 'st*****@example.com');
    assert.equal(maskEmail('a@example.com'), 'a*@example.com');
  });
});
