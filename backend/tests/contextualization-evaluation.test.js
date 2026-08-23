const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const cases = require('./fixtures/contextualizationEvaluationCases');
const { contextualizeQuestion } = require('../src/services/contextualQuestion.service');

function evaluate(testCase) {
  const actual = contextualizeQuestion({
    recentConversationHistory: testCase.history,
    currentQuestion: testCase.currentQuestion,
  });
  const failures = [];
  if (actual.requiresContext !== testCase.expectedRequiresContext) {
    failures.push(`requiresContext expected=${testCase.expectedRequiresContext} actual=${actual.requiresContext}`);
  }
  for (const value of testCase.mustContain || []) {
    if (!actual.standaloneQuestion.includes(value)) failures.push(`mustContain=${value}`);
  }
  for (const value of testCase.mustNotContain || []) {
    if (actual.standaloneQuestion.includes(value)) failures.push(`mustNotContain=${value}`);
  }
  return { actual, failures };
}

describe('contextualizer regression evaluation', () => {
  it('meets semantic constraints across the formal evaluation dataset', () => {
    assert.ok(cases.length >= 30);
    const byCategory = new Map();
    const failed = [];
    for (const testCase of cases) {
      const evaluation = evaluate(testCase);
      const category = byCategory.get(testCase.category) || { total: 0, passed: 0 };
      category.total += 1;
      if (!evaluation.failures.length) category.passed += 1;
      else failed.push({
        category: testCase.category,
        history: testCase.history,
        currentQuestion: testCase.currentQuestion,
        expected: {
          requiresContext: testCase.expectedRequiresContext,
          mustContain: testCase.mustContain,
          mustNotContain: testCase.mustNotContain,
        },
        actualStandaloneQuestion: evaluation.actual.standaloneQuestion,
        actualRequiresContext: evaluation.actual.requiresContext,
        failures: evaluation.failures,
      });
      byCategory.set(testCase.category, category);
    }
    const passed = cases.length - failed.length;
    const metrics = {
      totalCases: cases.length,
      passed,
      failed: failed.length,
      passRate: Number(((passed / cases.length) * 100).toFixed(2)),
      passRateByCategory: Object.fromEntries([...byCategory].map(([category, value]) => [
        category,
        Number(((value.passed / value.total) * 100).toFixed(2)),
      ])),
    };
    console.info('[contextualizer-evaluation]', metrics);
    assert.deepEqual(failed, [], JSON.stringify({ metrics, failed }, null, 2));
    assert.equal(metrics.passRate, 100);
  });
});
