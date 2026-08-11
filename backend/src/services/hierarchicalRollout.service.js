const ROLLOUT_MODES = Object.freeze({
  OFF: 'off',
  SHADOW: 'shadow',
  SERVE: 'serve',
});

const ROLLOUT_REASONS = Object.freeze({
  GLOBAL_GATE_DISABLED: 'GLOBAL_GATE_DISABLED',
  ROLLOUT_MODE_OFF: 'ROLLOUT_MODE_OFF',
  INVALID_ROLLOUT_MODE: 'INVALID_ROLLOUT_MODE',
  INVALID_ALLOWLIST_CONFIG: 'INVALID_ALLOWLIST_CONFIG',
  COURSE_NOT_ALLOWLISTED: 'COURSE_NOT_ALLOWLISTED',
  USER_NOT_ALLOWLISTED: 'USER_NOT_ALLOWLISTED',
  NO_AUTHORIZED_VIDEO: 'NO_AUTHORIZED_VIDEO',
  NO_SUPPORTED_VIDEO_INTERSECTION: 'NO_SUPPORTED_VIDEO_INTERSECTION',
  EMBEDDING_CONTRACT_NOT_DECLARED: 'EMBEDDING_CONTRACT_NOT_DECLARED',
  EMBEDDING_CONTRACT_INCOMPATIBLE: 'EMBEDDING_CONTRACT_INCOMPATIBLE',
  SHADOW_ELIGIBLE: 'SHADOW_ELIGIBLE',
  SERVE_ELIGIBLE: 'SERVE_ELIGIBLE',
});

const CANONICAL_ID_PATTERN = /^[a-f\d]{24}$/i;

function normalizeIdentifiers(values) {
  const seen = new Set();
  const normalized = [];
  for (const value of Array.from(values || [])) {
    const id = String(value || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  return normalized;
}

function parseIdentifierAllowlist(rawValue) {
  const values = normalizeIdentifiers(String(rawValue || '').split(','));
  const invalidValues = values.filter((value) => !CANONICAL_ID_PATTERN.test(value));
  return {
    values: invalidValues.length ? [] : values,
    valid: invalidValues.length === 0,
    configured: values.length > 0,
  };
}

function parseRolloutMode(rawValue) {
  const requested = String(rawValue || ROLLOUT_MODES.OFF).trim().toLowerCase();
  const valid = Object.values(ROLLOUT_MODES).includes(requested);
  return {
    value: valid ? requested : ROLLOUT_MODES.OFF,
    requested,
    valid,
  };
}

function intersectAuthorizedRolloutVideos(allowedVideoIds, configuredRolloutVideoIds) {
  const authorized = normalizeIdentifiers(allowedVideoIds);
  const configured = new Set(normalizeIdentifiers(configuredRolloutVideoIds));
  return authorized.filter((videoId) => configured.has(videoId));
}

function rolloutDiagnostics({
  mode,
  eligible,
  reason,
  authorizedVideoIds,
  rolloutVideoIds,
  authorizedSupportedVideoIds,
}) {
  return {
    retrievalRolloutMode: mode,
    hierarchicalEligible: eligible,
    hierarchicalEligibilityReason: reason,
    hierarchicalAuthorizedVideoCount: authorizedVideoIds.length,
    hierarchicalSupportedVideoCount: rolloutVideoIds.length,
    hierarchicalAuthorizedSupportedVideoCount: authorizedSupportedVideoIds.length,
  };
}

function evaluateHierarchicalRollout({
  globalEnabled,
  rolloutMode,
  rolloutModeValid = true,
  userId,
  courseId,
  allowedVideoIds,
  allowedCourseIds = [],
  rolloutVideoIds = [],
  rolloutUserIds = [],
  allowlistsValid = true,
  embeddingContractStatus,
}) {
  const mode = Object.values(ROLLOUT_MODES).includes(rolloutMode)
    ? rolloutMode
    : ROLLOUT_MODES.OFF;
  const authorizedVideoIds = normalizeIdentifiers(allowedVideoIds);
  const supportedVideoIds = normalizeIdentifiers(rolloutVideoIds);
  const authorizedSupportedVideoIds = intersectAuthorizedRolloutVideos(
    authorizedVideoIds,
    supportedVideoIds,
  );
  const courseAllowlist = normalizeIdentifiers(allowedCourseIds);
  const userAllowlist = normalizeIdentifiers(rolloutUserIds);

  let reason;
  if (!globalEnabled) reason = ROLLOUT_REASONS.GLOBAL_GATE_DISABLED;
  else if (!rolloutModeValid) reason = ROLLOUT_REASONS.INVALID_ROLLOUT_MODE;
  else if (!allowlistsValid) reason = ROLLOUT_REASONS.INVALID_ALLOWLIST_CONFIG;
  else if (mode === ROLLOUT_MODES.OFF) reason = ROLLOUT_REASONS.ROLLOUT_MODE_OFF;
  else if (embeddingContractStatus === 'not_declared') {
    reason = ROLLOUT_REASONS.EMBEDDING_CONTRACT_NOT_DECLARED;
  } else if (embeddingContractStatus !== 'compatible') {
    reason = ROLLOUT_REASONS.EMBEDDING_CONTRACT_INCOMPATIBLE;
  } else if (courseAllowlist.length && !courseAllowlist.includes(String(courseId || ''))) {
    reason = ROLLOUT_REASONS.COURSE_NOT_ALLOWLISTED;
  } else if (userAllowlist.length && !userAllowlist.includes(String(userId || ''))) {
    reason = ROLLOUT_REASONS.USER_NOT_ALLOWLISTED;
  } else if (!authorizedVideoIds.length) {
    reason = ROLLOUT_REASONS.NO_AUTHORIZED_VIDEO;
  } else if (!authorizedSupportedVideoIds.length) {
    reason = ROLLOUT_REASONS.NO_SUPPORTED_VIDEO_INTERSECTION;
  } else {
    reason = mode === ROLLOUT_MODES.SHADOW
      ? ROLLOUT_REASONS.SHADOW_ELIGIBLE
      : ROLLOUT_REASONS.SERVE_ELIGIBLE;
  }

  const eligible = reason === ROLLOUT_REASONS.SHADOW_ELIGIBLE
    || reason === ROLLOUT_REASONS.SERVE_ELIGIBLE;

  return {
    eligible,
    mode,
    reason,
    authorizedSupportedVideoIds,
    diagnostics: rolloutDiagnostics({
      mode,
      eligible,
      reason,
      authorizedVideoIds,
      rolloutVideoIds: supportedVideoIds,
      authorizedSupportedVideoIds,
    }),
  };
}

function safeErrorCode(error) {
  return String(error?.details?.reason || error?.code || 'SHADOW_RETRIEVAL_FAILED');
}

function buildShadowDiagnostics(result, latencyMs) {
  const hierarchy = result.diagnostics?.hierarchical || {};
  const details = hierarchy.diagnostics || {};
  return {
    shadowExecuted: true,
    shadowParentHitCount: hierarchy.parentHitCount || 0,
    shadowTopScore: hierarchy.parentTopScore ?? null,
    shadowSecondScore: hierarchy.parentSecondScore ?? null,
    shadowTopTwoGap: hierarchy.parentTopTwoGap ?? null,
    shadowChildRequested: details.requestedChildCount || 0,
    shadowChildFound: details.foundChildCount || 0,
    shadowChildMissing: details.missingChildCount || 0,
    shadowScopeMismatch: details.scopeMismatchCount || 0,
    shadowTruncatedChildCount: details.truncatedChildCount || 0,
    shadowLatencyMs: latencyMs,
    shadowError: null,
  };
}

async function executeHierarchicalRollout({
  decision,
  leafSearch,
  hierarchicalSearch,
}) {
  if (!decision.eligible || decision.mode === ROLLOUT_MODES.OFF) {
    const leafResult = await leafSearch();
    return {
      ...leafResult,
      diagnostics: {
        ...(leafResult.diagnostics || {}),
        rollout: { ...decision.diagnostics, shadowExecuted: false },
      },
    };
  }

  if (decision.mode === ROLLOUT_MODES.SERVE) {
    const result = await hierarchicalSearch();
    return {
      ...result,
      diagnostics: {
        ...(result.diagnostics || {}),
        rollout: { ...decision.diagnostics, shadowExecuted: false },
      },
    };
  }

  const leafResult = await leafSearch();
  const startedAt = Date.now();
  let shadow;
  try {
    const shadowResult = await hierarchicalSearch({ shadow: true });
    shadow = buildShadowDiagnostics(shadowResult, Date.now() - startedAt);
  } catch (error) {
    shadow = {
      shadowExecuted: true,
      shadowParentHitCount: 0,
      shadowTopScore: null,
      shadowSecondScore: null,
      shadowTopTwoGap: null,
      shadowChildRequested: 0,
      shadowChildFound: 0,
      shadowChildMissing: 0,
      shadowScopeMismatch: 0,
      shadowTruncatedChildCount: 0,
      shadowLatencyMs: Date.now() - startedAt,
      shadowError: safeErrorCode(error),
    };
  }

  return {
    ...leafResult,
    diagnostics: {
      ...(leafResult.diagnostics || {}),
      rollout: { ...decision.diagnostics, ...shadow },
    },
  };
}

module.exports = {
  ROLLOUT_MODES,
  ROLLOUT_REASONS,
  normalizeIdentifiers,
  parseIdentifierAllowlist,
  parseRolloutMode,
  intersectAuthorizedRolloutVideos,
  evaluateHierarchicalRollout,
  executeHierarchicalRollout,
};
