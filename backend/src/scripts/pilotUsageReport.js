// 試用期使用統計（唯讀）。
// 用法：npm run report:pilot-usage -- [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--course <courseId>] [--include-demo] [--json]
// 預設區間為最近 30 天（台北時間，含當日）；預設排除 @focusflow.local demo 帳號。
const mongoose = require('mongoose');
const env = require('../config/env');
const User = require('../models/user.model');
const Enrollment = require('../models/enrollment.model');
const Course = require('../models/course.model');
const UsageLog = require('../models/usageLog.model');
const Question = require('../models/question.model');
const {
  PilotUsageReportError,
  buildPilotUsageReport,
  formatPilotUsageReport,
  loadPilotUsageData,
  parseDateRange,
} = require('../services/pilotUsageReport.service');

function parseCliArgs(argv = []) {
  const options = { from: null, to: null, courseId: null, includeDemo: false, json: false };
  const takeValue = (flag, index) => {
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new PilotUsageReportError(`${flag} requires a value.`, 'PILOT_USAGE_CLI_INVALID');
    }
    return value;
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--from' || flag === '--to' || flag === '--course') {
      const value = takeValue(flag, index);
      if (flag === '--from') options.from = value;
      if (flag === '--to') options.to = value;
      if (flag === '--course') options.courseId = value;
      index += 1;
    } else if (flag === '--include-demo') {
      options.includeDemo = true;
    } else if (flag === '--json') {
      options.json = true;
    } else {
      throw new PilotUsageReportError(`Unknown argument: ${flag}`, 'PILOT_USAGE_CLI_INVALID');
    }
  }

  if (options.courseId && !mongoose.isValidObjectId(options.courseId)) {
    throw new PilotUsageReportError('--course must be a valid ObjectId.', 'PILOT_USAGE_CLI_INVALID');
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseCliArgs(argv);
    const range = parseDateRange({ from: options.from, to: options.to });

    // autoIndex / autoCreate 關閉，確保這支腳本不會順手建索引或 collection。
    await mongoose.connect(env.mongodbUri, { autoIndex: false, autoCreate: false });
    const data = await loadPilotUsageData(
      { User, Enrollment, Course, UsageLog, Question },
      { range, courseId: options.courseId },
    );
    const report = buildPilotUsageReport({
      ...data,
      range,
      courseId: options.courseId,
      includeDemo: options.includeDemo,
    });

    console.log(options.json ? JSON.stringify(report, null, 2) : formatPilotUsageReport(report));
  } catch (error) {
    console.error(JSON.stringify({
      success: false,
      code: error instanceof PilotUsageReportError ? error.code : 'PILOT_USAGE_REPORT_FAILED',
      message: error instanceof PilotUsageReportError ? error.message : error.message || 'Report failed.',
    }));
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) main();

module.exports = { main, parseCliArgs };
