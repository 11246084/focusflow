const {
  ENROLLMENT_STATUSES,
  QUESTION_SOURCES,
  USAGE_LOG_EVENTS,
  USER_ROLES,
} = require('../constants/enums');

// 試用期使用統計：只輸出彙總數字，不輸出學生姓名、Email 或提問內容。
// 老師看得到「誰問了什麼」會讓學生不敢問，所以這份報表刻意只到次數層級。

const DEFAULT_TIME_ZONE = 'Asia/Taipei';
const DEMO_EMAIL_SUFFIX = '@focusflow.local';
const COUNTED_QUESTION_SOURCES = [QUESTION_SOURCES.API, QUESTION_SOURCES.LINE];
// 只有登入不算「有在用」，至少要點開影片、看完或提問。
const ENGAGED_EVENTS = new Set([
  USAGE_LOG_EVENTS.VIDEO_OPEN,
  USAGE_LOG_EVENTS.WATCH,
  USAGE_LOG_EVENTS.ASK,
  USAGE_LOG_EVENTS.CLIP_VIEW,
]);
const REPORTED_EVENTS = [
  USAGE_LOG_EVENTS.LOGIN,
  USAGE_LOG_EVENTS.VIDEO_OPEN,
  USAGE_LOG_EVENTS.WATCH,
  USAGE_LOG_EVENTS.ASK,
  USAGE_LOG_EVENTS.CLIP_VIEW,
];
const QUESTION_BUCKETS = [
  { label: '0', min: 0, max: 0 },
  { label: '1-2', min: 1, max: 2 },
  { label: '3-5', min: 3, max: 5 },
  { label: '6-10', min: 6, max: 10 },
  { label: '11+', min: 11, max: Infinity },
];

class PilotUsageReportError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PilotUsageReportError';
    this.code = code;
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// 日期以台北時間解讀；to 是含當日，所以回傳隔天 00:00 作為不含的上界。
function parseDateRange({ from, to, now = new Date() } = {}) {
  const toDate = to || formatLocalDate(now);
  const fromDate = from || formatLocalDate(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));

  for (const [flag, value] of [['--from', fromDate], ['--to', toDate]]) {
    if (!DATE_PATTERN.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00+08:00`))) {
      throw new PilotUsageReportError(`${flag} must be YYYY-MM-DD.`, 'PILOT_USAGE_DATE_INVALID');
    }
  }

  const start = new Date(`${fromDate}T00:00:00+08:00`);
  const end = new Date(Date.parse(`${toDate}T00:00:00+08:00`) + 24 * 60 * 60 * 1000);
  if (start >= end) {
    throw new PilotUsageReportError('--from must not be after --to.', 'PILOT_USAGE_DATE_INVALID');
  }

  return { fromDate, toDate, start, end };
}

function formatLocalDate(date, timeZone = DEFAULT_TIME_ZONE) {
  // sv-SE 的日期格式剛好是 YYYY-MM-DD。
  return new Date(date).toLocaleDateString('sv-SE', { timeZone });
}

function isDemoEmail(email) {
  return String(email || '').toLowerCase().endsWith(DEMO_EMAIL_SUFFIX);
}

function rate(numerator, denominator) {
  if (!denominator) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function mean(values) {
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

function countBy(items, keyOf) {
  const counts = {};
  for (const item of items) {
    const key = keyOf(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function isFaqCacheHit(question) {
  return question?.runtime?.faqCache?.hit === true;
}

function summarizeActivity({ studentIds, usageLogs, questions }) {
  const activeIds = new Set();
  const engagedIds = new Set();
  for (const log of usageLogs) {
    const id = String(log.userId);
    if (!studentIds.has(id)) continue;
    activeIds.add(id);
    if (ENGAGED_EVENTS.has(log.event)) engagedIds.add(id);
  }

  const questionsPerStudent = new Map();
  for (const question of questions) {
    const id = String(question.userId);
    if (!studentIds.has(id)) continue;
    // LINE 提問不一定伴隨網頁登入紀錄，提問本身就代表有在用。
    activeIds.add(id);
    engagedIds.add(id);
    questionsPerStudent.set(id, (questionsPerStudent.get(id) || 0) + 1);
  }

  return { activeIds, engagedIds, questionsPerStudent };
}

function buildPilotUsageReport({
  students = [],
  enrollments = [],
  courses = [],
  usageLogs = [],
  questions = [],
  range,
  courseId = null,
  includeDemo = false,
  timeZone = DEFAULT_TIME_ZONE,
  generatedAt = new Date(),
}) {
  const courseFilter = courseId ? String(courseId) : null;
  const eligibleStudents = students.filter((student) => (
    student.role === USER_ROLES.STUDENT && (includeDemo || !isDemoEmail(student.email))
  ));
  const eligibleIds = new Set(eligibleStudents.map((student) => String(student._id)));

  const activeEnrollments = enrollments.filter((enrollment) => (
    enrollment.status === ENROLLMENT_STATUSES.ACTIVE
    && eligibleIds.has(String(enrollment.studentId))
    && (!courseFilter || String(enrollment.courseId) === courseFilter)
  ));
  const enrolledIds = new Set(activeEnrollments.map((enrollment) => String(enrollment.studentId)));

  const scopedLogs = usageLogs.filter((log) => (
    eligibleIds.has(String(log.userId))
    && (!courseFilter || String(log.courseId) === courseFilter)
  ));
  const scopedQuestions = questions.filter((question) => (
    eligibleIds.has(String(question.userId))
    && COUNTED_QUESTION_SOURCES.includes(question.source)
    && (!courseFilter || String(question.courseId) === courseFilter)
  ));

  const { activeIds, engagedIds, questionsPerStudent } = summarizeActivity({
    studentIds: eligibleIds,
    usageLogs: scopedLogs,
    questions: scopedQuestions,
  });

  // 母體 = 有 active 選課的學生；有使用但沒選課的另外列出，方便發現名單漏匯入。
  const activeNotEnrolled = [...activeIds].filter((id) => !enrolledIds.has(id)).length;
  const enrolledActive = [...enrolledIds].filter((id) => activeIds.has(id)).length;
  const enrolledEngaged = [...enrolledIds].filter((id) => engagedIds.has(id)).length;

  const eventCounts = countBy(scopedLogs, (log) => log.event);
  const events = Object.fromEntries(REPORTED_EVENTS.map((event) => [event, eventCounts[event] || 0]));

  const perAskerCounts = [...questionsPerStudent.values()];
  const bucketCounts = [...enrolledIds].map((id) => questionsPerStudent.get(id) || 0);
  const questionDistribution = QUESTION_BUCKETS.map((bucket) => ({
    questions: bucket.label,
    students: bucketCounts.filter((count) => count >= bucket.min && count <= bucket.max).length,
  }));

  const courseTitles = new Map(courses.map((course) => [String(course._id), course.title || '(未命名課程)']));
  const courseIds = new Set([
    ...activeEnrollments.map((enrollment) => String(enrollment.courseId)),
    ...scopedQuestions.map((question) => String(question.courseId)),
    ...scopedLogs.filter((log) => log.courseId).map((log) => String(log.courseId)),
  ]);
  const perCourse = [...courseIds].map((id) => {
    const enrolled = new Set(activeEnrollments
      .filter((enrollment) => String(enrollment.courseId) === id)
      .map((enrollment) => String(enrollment.studentId)));
    const courseLogs = scopedLogs.filter((log) => String(log.courseId) === id);
    const courseQuestions = scopedQuestions.filter((question) => String(question.courseId) === id);
    const engaged = new Set([
      ...courseLogs.filter((log) => ENGAGED_EVENTS.has(log.event)).map((log) => String(log.userId)),
      ...courseQuestions.map((question) => String(question.userId)),
    ]);
    const enrolledEngagedCount = [...enrolled].filter((studentId) => engaged.has(studentId)).length;

    return {
      courseId: id,
      title: courseTitles.get(id) || '(課程已刪除)',
      enrolledStudents: enrolled.size,
      engagedStudents: enrolledEngagedCount,
      engagementRatePct: rate(enrolledEngagedCount, enrolled.size),
      questions: courseQuestions.length,
      videoOpens: courseLogs.filter((log) => log.event === USAGE_LOG_EVENTS.VIDEO_OPEN).length,
      videoWatches: courseLogs.filter((log) => log.event === USAGE_LOG_EVENTS.WATCH).length,
    };
  }).sort((left, right) => right.questions - left.questions || right.enrolledStudents - left.enrolledStudents);

  const daily = new Map();
  const dayOf = (date) => formatLocalDate(date, timeZone);
  for (const log of scopedLogs) {
    const day = dayOf(log.timestamp);
    if (!daily.has(day)) daily.set(day, { active: new Set(), questions: 0 });
    daily.get(day).active.add(String(log.userId));
  }
  for (const question of scopedQuestions) {
    const day = dayOf(question.askedAt);
    if (!daily.has(day)) daily.set(day, { active: new Set(), questions: 0 });
    daily.get(day).active.add(String(question.userId));
    daily.get(day).questions += 1;
  }
  const dailyActivity = [...daily.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({ date, activeStudents: value.active.size, questions: value.questions }));

  const bySource = countBy(scopedQuestions, (question) => question.source);
  const byStatus = countBy(scopedQuestions, (question) => question.status || 'unknown');
  const faqCacheHits = scopedQuestions.filter(isFaqCacheHit).length;

  return {
    generatedAt: new Date(generatedAt).toISOString(),
    range: {
      from: range.fromDate,
      to: range.toDate,
      timeZone,
    },
    filters: {
      courseId: courseFilter,
      includeDemo,
      questionSources: COUNTED_QUESTION_SOURCES,
    },
    students: {
      enrolled: enrolledIds.size,
      active: enrolledActive,
      engaged: enrolledEngaged,
      activeRatePct: rate(enrolledActive, enrolledIds.size),
      engagedRatePct: rate(enrolledEngaged, enrolledIds.size),
      activeWithoutEnrollment: activeNotEnrolled,
    },
    events,
    questions: {
      total: scopedQuestions.length,
      bySource: {
        api: bySource[QUESTION_SOURCES.API] || 0,
        line: bySource[QUESTION_SOURCES.LINE] || 0,
      },
      byStatus,
      faqCacheHits,
      faqCacheHitRatePct: rate(faqCacheHits, scopedQuestions.length),
      askers: perAskerCounts.length,
      perAskerMean: mean(perAskerCounts),
      perAskerMedian: median(perAskerCounts),
    },
    questionDistribution,
    perCourse,
    dailyActivity,
  };
}

function formatPct(value) {
  return value === null ? '—' : `${value}%`;
}

function formatPilotUsageReport(report) {
  const lines = [];
  const { students, questions, events } = report;
  lines.push(`FocusFlow 試用期使用統計  ${report.range.from} ~ ${report.range.to}（${report.range.timeZone}）`);
  if (report.filters.courseId) lines.push(`課程篩選：${report.filters.courseId}`);
  if (report.filters.includeDemo) lines.push('（含 demo 帳號）');
  lines.push('');
  lines.push('【學生】');
  lines.push(`  有選課的學生         ${students.enrolled}`);
  lines.push(`  有任何活動（含登入） ${students.active}（${formatPct(students.activeRatePct)}）`);
  lines.push(`  實際使用（影片/提問）${students.engaged}（${formatPct(students.engagedRatePct)}）`);
  if (students.activeWithoutEnrollment) {
    lines.push(`  ⚠ 有使用但沒有 active 選課：${students.activeWithoutEnrollment} 人（檢查名單是否漏匯入）`);
  }
  lines.push('');
  lines.push('【提問】');
  lines.push(`  總數 ${questions.total}（網頁 ${questions.bySource.api} / LINE ${questions.bySource.line}）`);
  lines.push(`  狀態 ${Object.entries(questions.byStatus).map(([key, value]) => `${key}=${value}`).join('  ') || '—'}`);
  lines.push(`  FAQ 快取命中 ${questions.faqCacheHits}（${formatPct(questions.faqCacheHitRatePct)}）`);
  lines.push(`  提問人數 ${questions.askers}，每人平均 ${questions.perAskerMean ?? '—'} 題、中位數 ${questions.perAskerMedian ?? '—'} 題`);
  lines.push('');
  lines.push('【每位選課學生的提問數分布】');
  for (const bucket of report.questionDistribution) {
    lines.push(`  ${bucket.questions.padEnd(5)} 題：${bucket.students} 人`);
  }
  lines.push('');
  lines.push('【事件次數】');
  lines.push(`  登入 ${events.login}  影片點開 ${events.video_open}  看完(80%) ${events.watch}  問答 ${events.ask}  短影音 ${events.clip_view}`);
  lines.push('');
  lines.push('【各課程】');
  if (!report.perCourse.length) lines.push('  （無資料）');
  for (const course of report.perCourse) {
    lines.push(`  ${course.title}`);
    lines.push(`    選課 ${course.enrolledStudents}、實際使用 ${course.engagedStudents}（${formatPct(course.engagementRatePct)}）、提問 ${course.questions}、影片點開 ${course.videoOpens}、看完 ${course.videoWatches}`);
  }
  lines.push('');
  lines.push('【每日】日期 / 活躍學生 / 提問');
  if (!report.dailyActivity.length) lines.push('  （無資料）');
  for (const day of report.dailyActivity) {
    lines.push(`  ${day.date}  ${String(day.activeStudents).padStart(3)}  ${String(day.questions).padStart(4)}`);
  }
  return lines.join('\n');
}

// 只做 find（lean + projection），不寫入任何 collection；提問只取統計需要的欄位，不讀內容。
async function loadPilotUsageData(models, { range, courseId = null }) {
  const { User, Enrollment, Course, UsageLog, Question } = models;
  const timeFilter = { $gte: range.start, $lt: range.end };
  const courseMatch = courseId ? { courseId } : {};

  const [students, enrollments, usageLogs, questions] = await Promise.all([
    User.find({ role: USER_ROLES.STUDENT }).select('_id email role').lean(),
    Enrollment.find({ status: ENROLLMENT_STATUSES.ACTIVE, ...courseMatch })
      .select('studentId courseId status').lean(),
    UsageLog.find({ timestamp: timeFilter, event: { $in: REPORTED_EVENTS }, ...courseMatch })
      .select('userId courseId event timestamp').lean(),
    Question.find({ askedAt: timeFilter, source: { $in: COUNTED_QUESTION_SOURCES }, ...courseMatch })
      .select('userId courseId source status askedAt runtime.faqCache.hit').lean(),
  ]);

  const referencedCourseIds = [...new Set([
    ...enrollments.map((item) => String(item.courseId)),
    ...usageLogs.filter((item) => item.courseId).map((item) => String(item.courseId)),
    ...questions.map((item) => String(item.courseId)),
  ])];
  const courses = await Course.find({ _id: { $in: referencedCourseIds } }).select('_id title').lean();

  return { students, enrollments, courses, usageLogs, questions };
}

module.exports = {
  PilotUsageReportError,
  buildPilotUsageReport,
  formatPilotUsageReport,
  loadPilotUsageData,
  parseDateRange,
};
