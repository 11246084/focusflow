const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const bcrypt = require('bcryptjs');
const { ObjectId } = require('mongodb');
const {
  applyImport,
  buildImportPlan,
  parseArgs,
  parseCsv,
  selectEnrollmentTargets,
} = require('../src/scripts/importStudents');

const courseId = '69f82564736febac6db8e97b';
const existingStudentId = '69f82564736febac6db8e971';

function roster(lines) {
  return parseCsv(['姓名,Email,學號', ...lines].join('\r\n'));
}

describe('學生名單匯入', () => {
  it('預設 dry-run，apply 必須帶 expected-count', () => {
    assert.deepEqual(parseArgs(['--file', 'a.csv']), {
      file: 'a.csv', apply: false, courseId: '', expectedCount: null,
    });
    assert.throws(() => parseArgs(['--file', 'a.csv', '--apply']), /expected-count/);
  });

  it('CSV 解析可處理 BOM 與引號欄位', () => {
    const rows = parseCsv('﻿name,email,studentId\n"王, 小明",a@x.com,11246001\n');
    assert.deepEqual(rows, [['name', 'email', 'studentId'], ['王, 小明', 'a@x.com', '11246001']]);
  });

  it('既有 email 不重建、CSV 內重複與不合法資料列入 invalid', () => {
    const plan = buildImportPlan({
      rows: roster([
        '王小明,A@X.com,11246001',
        '李小華,b@x.com,11246002',
        '重複,a@x.com,11246003',
        '學號太短,c@x.com,123',
        ',d@x.com,11246004',
      ]),
      existingUsers: [{ _id: new ObjectId(existingStudentId), email: 'b@x.com', role: 'student', isActive: true }],
    });

    assert.deepEqual(plan.creates, [{ line: 2, name: '王小明', email: 'a@x.com', studentId: '11246001' }]);
    assert.equal(plan.existing.length, 1);
    assert.deepEqual(plan.invalid.map((item) => item.line), [4, 5, 6]);
  });

  it('缺少必要欄位時拒絕執行', () => {
    assert.throws(
      () => buildImportPlan({ rows: parseCsv('name,email\nx,a@x.com'), existingUsers: [] }),
      /studentId/,
    );
  });

  it('選課對象只含新帳號與既有的 active 學生', () => {
    const plan = {
      existing: [
        { userId: existingStudentId, role: 'student', isActive: true },
        { userId: 'teacher', role: 'teacher', isActive: true },
        { userId: 'inactive', role: 'student', isActive: false },
      ],
    };
    assert.deepEqual(selectEnrollmentTargets(plan, ['new1']), ['new1', existingStudentId]);
  });

  it('apply 以學號雜湊當密碼並寫入選課', async () => {
    const inserted = [];
    const bulkOps = [];
    const db = {
      collection(name) {
        if (name === 'users') {
          return {
            async insertMany(docs) {
              inserted.push(...docs);
              return { insertedIds: { 0: new ObjectId() } };
            },
          };
        }
        return {
          async bulkWrite(ops) {
            bulkOps.push(...ops);
            return { upsertedCount: ops.length, modifiedCount: 0 };
          },
        };
      },
    };
    const plan = buildImportPlan({ rows: roster(['王小明,a@x.com,11246001']), existingUsers: [] });

    const result = await applyImport(db, plan, { expectedCount: 1, courseId });

    assert.deepEqual(result, { created: 1, enrolled: 1 });
    assert.equal(inserted[0].role, 'student');
    assert.equal(await bcrypt.compare('11246001', inserted[0].passwordHash), true);
    assert.equal(bulkOps[0].updateOne.filter.courseId.toString(), courseId);
  });

  it('dry-run 後名單變動時 apply 中止', async () => {
    const plan = buildImportPlan({ rows: roster(['王小明,a@x.com,11246001']), existingUsers: [] });
    await assert.rejects(() => applyImport({}, plan, { expectedCount: 2 }), /Run dry-run again/);
  });
});
