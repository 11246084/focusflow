const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPilotUsageReport,
  formatPilotUsageReport,
  parseDateRange,
} = require('../src/services/pilotUsageReport.service');
const { parseCliArgs } = require('../src/scripts/pilotUsageReport');

const COURSE_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const COURSE_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const range = parseDateRange({ from: '2026-09-01', to: '2026-09-07' });

function fixture() {
  return {
    students: [
      { _id: 's1', email: 's1@ntub.edu.tw', role: 'student' },
      { _id: 's2', email: 's2@ntub.edu.tw', role: 'student' },
      { _id: 's3', email: 's3@ntub.edu.tw', role: 'student' },
      { _id: 's4', email: 's4@ntub.edu.tw', role: 'student' },
      { _id: 'demo', email: 'student@focusflow.local', role: 'student' },
    ],
    enrollments: [
      { studentId: 's1', courseId: COURSE_A, status: 'active' },
      { studentId: 's2', courseId: COURSE_A, status: 'active' },
      { studentId: 's3', courseId: COURSE_B, status: 'active' },
      { studentId: 's4', courseId: COURSE_B, status: 'revoked' },
      { studentId: 'demo', courseId: COURSE_A, status: 'active' },
    ],
    courses: [
      { _id: COURSE_A, title: '會計學' },
      { _id: COURSE_B, title: '統計學' },
    ],
    usageLogs: [
      { userId: 's1', courseId: null, event: 'login', timestamp: new Date('2026-09-01T02:00:00Z') },
      { userId: 's1', courseId: COURSE_A, event: 'video_open', timestamp: new Date('2026-09-01T02:05:00Z') },
      { userId: 's2', courseId: null, event: 'login', timestamp: new Date('2026-09-02T02:00:00Z') },
      { userId: 'demo', courseId: COURSE_A, event: 'video_open', timestamp: new Date('2026-09-02T03:00:00Z') },
    ],
    questions: [
      { userId: 's1', courseId: COURSE_A, source: 'api', status: 'answered', askedAt: new Date('2026-09-01T02:10:00Z'), runtime: { faqCache: { hit: true } } },
      { userId: 's1', courseId: COURSE_A, source: 'api', status: 'answered', askedAt: new Date('2026-09-01T16:30:00Z') },
      { userId: 's1', courseId: COURSE_A, source: 'line', status: 'no_match', askedAt: new Date('2026-09-03T02:00:00Z') },
      { userId: 's4', courseId: COURSE_B, source: 'line', status: 'answered', askedAt: new Date('2026-09-03T02:00:00Z') },
      { userId: 's1', courseId: COURSE_A, source: 'debug', status: 'answered', askedAt: new Date('2026-09-03T02:00:00Z') },
      { userId: 'demo', courseId: COURSE_A, source: 'api', status: 'answered', askedAt: new Date('2026-09-03T02:00:00Z') },
    ],
  };
}

describe('pilotUsageReport.service', () => {
  it('日期以台北時間解讀且 to 含當日', () => {
    assert.equal(range.start.toISOString(), '2026-08-31T16:00:00.000Z');
    assert.equal(range.end.toISOString(), '2026-09-07T16:00:00.000Z');
  });

  it('from 晚於 to 時拒絕', () => {
    assert.throws(() => parseDateRange({ from: '2026-09-08', to: '2026-09-01' }), { code: 'PILOT_USAGE_DATE_INVALID' });
  });

  it('日期格式錯誤時拒絕', () => {
    assert.throws(() => parseDateRange({ from: '2026/09/01', to: '2026-09-07' }), { code: 'PILOT_USAGE_DATE_INVALID' });
  });

  it('只以 active 選課學生為母體並區分登入與實際使用', () => {
    const report = buildPilotUsageReport({ ...fixture(), range });
    assert.deepEqual(report.students, {
      enrolled: 3,
      active: 2,
      engaged: 1,
      activeRatePct: 66.7,
      engagedRatePct: 33.3,
      activeWithoutEnrollment: 1,
    });
  });

  it('預設排除 demo 帳號與 debug 提問', () => {
    const report = buildPilotUsageReport({ ...fixture(), range });
    assert.equal(report.questions.total, 4);
    assert.deepEqual(report.questions.bySource, { api: 2, line: 2 });
  });

  it('加上 includeDemo 後納入 demo 帳號', () => {
    const report = buildPilotUsageReport({ ...fixture(), range, includeDemo: true });
    assert.equal(report.students.enrolled, 4);
    assert.equal(report.questions.total, 5);
  });

  it('統計 FAQ 命中與每人提問數', () => {
    const { questions } = buildPilotUsageReport({ ...fixture(), range });
    assert.equal(questions.faqCacheHits, 1);
    assert.equal(questions.askers, 2);
    assert.equal(questions.perAskerMean, 2);
    assert.equal(questions.perAskerMedian, 2);
  });

  it('提問數分布以選課學生計算且包含 0 題', () => {
    const { questionDistribution } = buildPilotUsageReport({ ...fixture(), range });
    assert.deepEqual(questionDistribution.map((bucket) => bucket.students), [2, 0, 1, 0, 0]);
  });

  it('每日活動以台北日期分組', () => {
    const { dailyActivity } = buildPilotUsageReport({ ...fixture(), range });
    assert.deepEqual(dailyActivity, [
      { date: '2026-09-01', activeStudents: 1, questions: 1 },
      { date: '2026-09-02', activeStudents: 2, questions: 1 },
      { date: '2026-09-03', activeStudents: 2, questions: 2 },
    ]);
  });

  it('指定課程時只計算該課程', () => {
    const report = buildPilotUsageReport({ ...fixture(), range, courseId: COURSE_A });
    assert.equal(report.students.enrolled, 2);
    assert.equal(report.questions.total, 3);
    assert.deepEqual(report.perCourse.map((course) => course.title), ['會計學']);
  });

  it('各課程列出選課、實際使用與提問數', () => {
    const { perCourse } = buildPilotUsageReport({ ...fixture(), range });
    assert.deepEqual(perCourse[0], {
      courseId: COURSE_A,
      title: '會計學',
      enrolledStudents: 2,
      engagedStudents: 1,
      engagementRatePct: 50,
      questions: 3,
      videoOpens: 1,
      videoWatches: 0,
    });
  });

  it('報表不輸出學生 Email', () => {
    const report = buildPilotUsageReport({ ...fixture(), range });
    const output = `${formatPilotUsageReport(report)}${JSON.stringify(report)}`;
    assert.equal(output.includes('@ntub.edu.tw'), false);
  });
});

describe('pilotUsageReport CLI 參數', () => {
  it('解析所有旗標', () => {
    assert.deepEqual(
      parseCliArgs(['--from', '2026-09-01', '--to', '2026-09-07', '--course', COURSE_A, '--include-demo', '--json']),
      { from: '2026-09-01', to: '2026-09-07', courseId: COURSE_A, includeDemo: true, json: true },
    );
  });

  it('未知參數時拒絕', () => {
    assert.throws(() => parseCliArgs(['--foo']), { code: 'PILOT_USAGE_CLI_INVALID' });
  });

  it('課程 ID 格式錯誤時拒絕', () => {
    assert.throws(() => parseCliArgs(['--course', 'abc']), { code: 'PILOT_USAGE_CLI_INVALID' });
  });
});
