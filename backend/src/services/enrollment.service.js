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

module.exports = {
  listCourseEnrollments,
  assignStudent,
  revokeStudent,
};
