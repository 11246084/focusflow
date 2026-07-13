const UsageLog = require('../models/usageLog.model');
const env = require('../config/env');
const AppError = require('../utils/appError');
const { USAGE_LOG_EVENTS } = require('../constants/enums');

function getCurrentMonthKey(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getCurrentMonthWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return { start, end };
}

function getConfiguredTokenBudgets() {
  return {
    estimatedTokensPerAsk: Math.max(1, Number(env.qaEstimatedTokensPerAsk) || 1),
    monthlyTokenBudget: Math.max(0, Number(env.qaMonthlyTokenBudget) || 0),
    userMonthlyTokenQuota: Math.max(0, Number(env.qaUserMonthlyTokenQuota) || 0),
  };
}

function buildCostControlSnapshot() {
  const budgets = getConfiguredTokenBudgets();

  return {
    enabled: budgets.monthlyTokenBudget > 0 || budgets.userMonthlyTokenQuota > 0,
    resetCadence: 'calendar_month_utc',
    estimatedTokensPerAsk: budgets.estimatedTokensPerAsk,
    monthlyTokenBudget: budgets.monthlyTokenBudget,
    userMonthlyTokenQuota: budgets.userMonthlyTokenQuota,
  };
}

async function countMonthlyAskEvents({ userId = null, now = new Date() } = {}) {
  const { start, end } = getCurrentMonthWindow(now);
  const query = {
    event: USAGE_LOG_EVENTS.ASK,
    timestamp: {
      $gte: start,
      $lt: end,
    },
  };

  if (userId) {
    query.userId = userId;
  }

  return UsageLog.countDocuments(query);
}

function buildQuotaDetails({ scope, usedEvents, projectedEvents, usedTokens, projectedTokens, limitTokens, now }) {
  return {
    scope,
    month: getCurrentMonthKey(now),
    resetCadence: 'calendar_month_utc',
    usedEvents,
    projectedEvents,
    usedTokens,
    projectedTokens,
    limitTokens,
  };
}

async function assertQaQuotaAvailable({ userId, now = new Date() }) {
  const budgets = getConfiguredTokenBudgets();
  const monthlyAskCount = await countMonthlyAskEvents({ now });
  const userMonthlyAskCount = await countMonthlyAskEvents({ userId, now });
  const globalProjectedEvents = monthlyAskCount + 1;
  const userProjectedEvents = userMonthlyAskCount + 1;
  const globalUsedTokens = monthlyAskCount * budgets.estimatedTokensPerAsk;
  const userUsedTokens = userMonthlyAskCount * budgets.estimatedTokensPerAsk;
  const globalProjectedTokens = globalProjectedEvents * budgets.estimatedTokensPerAsk;
  const userProjectedTokens = userProjectedEvents * budgets.estimatedTokensPerAsk;

  if (budgets.monthlyTokenBudget > 0 && globalProjectedTokens > budgets.monthlyTokenBudget) {
    throw new AppError(
      'Monthly QA token budget exceeded.',
      429,
      'QA_QUOTA_EXCEEDED',
      buildQuotaDetails({
        scope: 'global',
        usedEvents: monthlyAskCount,
        projectedEvents: globalProjectedEvents,
        usedTokens: globalUsedTokens,
        projectedTokens: globalProjectedTokens,
        limitTokens: budgets.monthlyTokenBudget,
        now,
      }),
    );
  }

  if (budgets.userMonthlyTokenQuota > 0 && userProjectedTokens > budgets.userMonthlyTokenQuota) {
    throw new AppError(
      'Monthly QA token quota exceeded for this user.',
      429,
      'QA_QUOTA_EXCEEDED',
      buildQuotaDetails({
        scope: 'user',
        usedEvents: userMonthlyAskCount,
        projectedEvents: userProjectedEvents,
        usedTokens: userUsedTokens,
        projectedTokens: userProjectedTokens,
        limitTokens: budgets.userMonthlyTokenQuota,
        now,
      }),
    );
  }

  return {
    month: getCurrentMonthKey(now),
    resetCadence: 'calendar_month_utc',
    estimatedTokens: budgets.estimatedTokensPerAsk,
    monthlyTokenBudget: budgets.monthlyTokenBudget,
    userMonthlyTokenQuota: budgets.userMonthlyTokenQuota,
    global: {
      usedEvents: monthlyAskCount,
      projectedEvents: globalProjectedEvents,
      usedTokens: globalUsedTokens,
      projectedTokens: globalProjectedTokens,
    },
    user: {
      usedEvents: userMonthlyAskCount,
      projectedEvents: userProjectedEvents,
      usedTokens: userUsedTokens,
      projectedTokens: userProjectedTokens,
    },
  };
}

module.exports = {
  getCurrentMonthKey,
  getCurrentMonthWindow,
  buildCostControlSnapshot,
  assertQaQuotaAvailable,
};
