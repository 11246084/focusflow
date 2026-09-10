const bcrypt = require('bcryptjs');
const Enrollment = require('../models/enrollment.model');
const User = require('../models/user.model');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const { USER_ROLES, ENROLLMENT_STATUSES } = require('../constants/enums');
const {
  getCourseByIdOrThrow,
  assertCanManageCourse,
  buildActiveEnrollmentFilter,
} = require('./courseAccess.service');

function toPublicEnrollment(enrollment, student) {
  return {
    id: String(enrollment._id),
    courseId: String(enrollment.courseId?._id || enrollment.courseId),
    status: enrollment.status || ENROLLMENT_STATUSES.ACTIVE,
    enrolledAt: enrollment.enrolledAt || enrollment.createdAt || null,
    progress: enrollment.progress || 0,
    student: {
      id: String(student._id),
      name: student.name,
      email: student.email,
      isActive: student.isActive !== false,
    },
  };
}

async function resolveManageableCourse(user, courseId) {
  const course = await getCourseByIdOrThrow(courseId);
  await assertCanManageCourse(user, course);
  return course;
}

async function listCourseEnrollments({ user, courseId }) {
  const course = await resolveManageableCourse(user, courseId);
  const enrollments = await Enrollment.find(buildActiveEnrollmentFilter({ courseId: course._id }))
    .sort({ enrolledAt: -1 })
    .lean();
  const studentIds = enrollments.map((item) => item.studentId?._id || item.studentId);
  const students = studentIds.length
    ? await User.find({ _id: { $in: studentIds }, role: USER_ROLES.STUDENT }).lean()
    : [];
  const studentMap = new Map(students.map((student) => [String(student._id), student]));

  // Orphaned relationships are omitted from the response rather than leaking
  // incomplete student records to the management UI.
  return enrollments
    .map((enrollment) => {
      const student = studentMap.get(String(enrollment.studentId?._id || enrollment.studentId));
      return student ? toPublicEnrollment(enrollment, student) : null;
    })
    .filter(Boolean);
}

async function assignStudent({ user, courseId, studentEmail }) {
  const course = await resolveManageableCourse(user, courseId);
  const email = String(studentEmail || '').trim().toLowerCase();
  if (!email) {
    throw new AppError('Student email is required.', 400, 'VALIDATION_ERROR');
  }

  const student = await User.findOne({ email });
  if (!student || student.role !== USER_ROLES.STUDENT || student.isActive === false) {
    throw new AppError('Active student not found.', 404, 'STUDENT_NOT_FOUND');
  }

  const now = new Date();
  // Reactivate the unique relationship in place so repeated assignment is
  // idempotent and previous progress is preserved.
  const enrollment = await Enrollment.findOneAndUpdate(
    { studentId: student._id, courseId: course._id },
    {
      $set: {
        status: ENROLLMENT_STATUSES.ACTIVE,
        assignedBy: user.id,
        enrolledAt: now,
      },
      $unset: { revokedAt: 1, revokedBy: 1 },
      $setOnInsert: {
        studentId: student._id,
        courseId: course._id,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  return toPublicEnrollment(enrollment, student);
}

async function revokeStudent({ user, courseId, studentId }) {
  const course = await resolveManageableCourse(user, courseId);
  assertObjectId(studentId, 'student');
  const student = await User.findById(studentId);
  if (!student || student.role !== USER_ROLES.STUDENT) {
    throw new AppError('Student not found.', 404, 'STUDENT_NOT_FOUND');
  }

  const existing = await Enrollment.findOne(buildActiveEnrollmentFilter({
    studentId: student._id,
    courseId: course._id,
  }));
  if (!existing) {
    throw new AppError('Active enrollment not found.', 404, 'ENROLLMENT_NOT_FOUND');
  }

  const enrollment = await Enrollment.findOneAndUpdate(
    { _id: existing._id },
    {
      $set: {
        status: ENROLLMENT_STATUSES.REVOKED,
        revokedAt: new Date(),
        revokedBy: user.id,
      },
    },
    { new: true },
  );

  // Revoke current LINE scope and its contextual history immediately. Historical
  // Question and UsageLog records remain untouched for audit/statistics.
  await User.updateMany(
    { _id: student._id, activeCourseId: course._id },
    {
      $unset: { activeCourseId: 1 },
      $set: { lineConversationState: 'idle', lineConversationHistory: [] },
    },
  );

  return toPublicEnrollment(enrollment, student);
}

const IMPORT_MAX_ROWS = 200;
const IMPORT_MIN_PASSWORD_LENGTH = 8;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function activateEnrollment({ user, course, studentId, now }) {
  await Enrollment.findOneAndUpdate(
    { studentId, courseId: course._id },
    {
      $set: {
        status: ENROLLMENT_STATUSES.ACTIVE,
        assignedBy: user.id,
        enrolledAt: now,
      },
      $unset: { revokedAt: 1, revokedBy: 1 },
      $setOnInsert: { studentId, courseId: course._id },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

// Roster import: missing accounts are created as students with the student
// number as initial password; existing accounts are only enrolled, never
// modified, so an import cannot reset a password or promote/demote a role.
async function importStudents({ user, courseId, students }) {
  const course = await resolveManageableCourse(user, courseId);
  if (!Array.isArray(students) || students.length === 0) {
    throw new AppError('Students must be a non-empty array.', 400, 'VALIDATION_ERROR');
  }
  if (students.length > IMPORT_MAX_ROWS) {
    throw new AppError(`At most ${IMPORT_MAX_ROWS} students per import.`, 400, 'VALIDATION_ERROR');
  }

  const skipped = [];
  const seenEmails = new Set();
  const rows = [];
  students.forEach((item, index) => {
    const row = index + 1;
    const name = String(item?.name || '').trim();
    const email = String(item?.email || '').trim().toLowerCase();
    const studentNumber = String(item?.studentId || '').trim();
    if (!name) return skipped.push({ row, email, reason: 'INVALID_NAME' });
    if (!EMAIL_REGEX.test(email)) return skipped.push({ row, email, reason: 'INVALID_EMAIL' });
    if (studentNumber.length < IMPORT_MIN_PASSWORD_LENGTH) {
      return skipped.push({ row, email, reason: 'STUDENT_ID_TOO_SHORT' });
    }
    if (seenEmails.has(email)) return skipped.push({ row, email, reason: 'DUPLICATE_IN_FILE' });
    seenEmails.add(email);
    rows.push({ row, name, email, studentNumber });
    return undefined;
  });

  const existingUsers = rows.length
    ? await User.find({ email: { $in: rows.map((item) => item.email) } }).lean()
    : [];
  const existingByEmail = new Map(existingUsers.map((item) => [item.email, item]));
  const now = new Date();
  let created = 0;
  let enrolled = 0;

  for (const item of rows) {
    let student = existingByEmail.get(item.email);
    if (student && student.role !== USER_ROLES.STUDENT) {
      skipped.push({ row: item.row, email: item.email, reason: 'NOT_STUDENT' });
      continue;
    }
    if (student && student.isActive === false) {
      skipped.push({ row: item.row, email: item.email, reason: 'INACTIVE_ACCOUNT' });
      continue;
    }
    if (!student) {
      try {
        student = await User.create({
          name: item.name,
          email: item.email,
          passwordHash: await bcrypt.hash(item.studentNumber, 10),
          role: USER_ROLES.STUDENT,
        });
        created += 1;
      } catch (error) {
        // Another request created the same email in between; leave that account untouched.
        if (error?.code === 11000) {
          skipped.push({ row: item.row, email: item.email, reason: 'DUPLICATE_ACCOUNT' });
          continue;
        }
        throw error;
      }
    }
    await activateEnrollment({ user, course, studentId: student._id, now });
    enrolled += 1;
  }

  skipped.sort((left, right) => left.row - right.row);
  return { created, enrolled, skipped };
}

module.exports = {
  listCourseEnrollments,
  assignStudent,
  revokeStudent,
  importStudents,
};
