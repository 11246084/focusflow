const WRITE_COMMANDS = new Set([
  'insert',
  'update',
  'delete',
  'findandmodify',
  'bulkwrite',
  'createindexes',
  'dropindexes',
  'create',
  'drop',
  'dropdatabase',
  'collmod',
  'renamecollection',
]);

const READ_COMMANDS = new Set([
  'aggregate',
  'count',
  'find',
  'getmore',
  'listcollections',
  'listindexes',
  'listsearchindexes',
  'connectionstatus',
  'distinct',
  'explain',
  'ping',
]);

class ConversationTurnAnalyticsError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ConversationTurnAnalyticsError';
    this.code = code;
  }
}

function normalizeId(value) {
  if (value == null) return '';
  return String(value);
}

function compareDocuments(left, right) {
  const parsedLeftTime = new Date(left?.createdAt || 0).getTime();
  const parsedRightTime = new Date(right?.createdAt || 0).getTime();
  const leftTime = Number.isFinite(parsedLeftTime) ? parsedLeftTime : 0;
  const rightTime = Number.isFinite(parsedRightTime) ? parsedRightTime : 0;
  if (leftTime !== rightTime) return leftTime - rightTime;
  return normalizeId(left?._id).localeCompare(normalizeId(right?._id));
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function distributionRows(distribution, countField) {
  return [...distribution.entries()]
    .sort(([left], [right]) => left - right)
    .map(([turns, count]) => ({ turns, [countField]: count }));
}

function createTurnUsageRow(turnNumber) {
  return {
    turnNumber,
    observedTurnCount: 0,
    rewriteUsedCount: 0,
    rewriteNotUsedCount: 0,
    rewriteUnknownCount: 0,
    completedCount: 0,
    failedCount: 0,
    pendingOrUnansweredCount: 0,
  };
}

function selectReply(replies) {
  const sorted = [...(replies || [])].sort(compareDocuments);
  const completed = sorted.filter((message) => message.status === 'completed');
  return completed.at(-1) || sorted.at(-1) || null;
}

function aggregateWebTurns({ conversations = [], messages = [] } = {}) {
  const conversationIds = new Set(
    conversations.map((conversation) => normalizeId(conversation?._id)).filter(Boolean),
  );
  const userMessagesByConversation = new Map();
  const repliesByUserMessage = new Map();

  for (const message of messages) {
    const conversationId = normalizeId(message?.conversationId);
    if (!conversationIds.has(conversationId)) continue;

    if (message?.role === 'user') {
      if (!userMessagesByConversation.has(conversationId)) {
        userMessagesByConversation.set(conversationId, []);
      }
      userMessagesByConversation.get(conversationId).push(message);
    } else if (message?.role === 'assistant' && message?.replyToMessageId) {
      const replyToMessageId = normalizeId(message.replyToMessageId);
      if (!repliesByUserMessage.has(replyToMessageId)) {
        repliesByUserMessage.set(replyToMessageId, []);
      }
      repliesByUserMessage.get(replyToMessageId).push(message);
    }
  }

  const conversationLengthDistribution = new Map();
  const turnUsageByNumber = new Map();
  let observedTurnCount = 0;
  let rewriteKnownCount = 0;

  for (const conversationId of conversationIds) {
    const userMessages = [...(userMessagesByConversation.get(conversationId) || [])]
      .sort(compareDocuments);
    increment(conversationLengthDistribution, userMessages.length);
    observedTurnCount += userMessages.length;

    userMessages.forEach((userMessage, index) => {
      const turnNumber = index + 1;
      const row = turnUsageByNumber.get(turnNumber) || createTurnUsageRow(turnNumber);
      const reply = selectReply(repliesByUserMessage.get(normalizeId(userMessage?._id)));
      const requiresContext = reply?.runtime?.conversation?.requiresContext;

      row.observedTurnCount += 1;
      if (typeof requiresContext === 'boolean') {
        rewriteKnownCount += 1;
        if (requiresContext) row.rewriteUsedCount += 1;
        else row.rewriteNotUsedCount += 1;
      } else {
        row.rewriteUnknownCount += 1;
      }

      if (reply?.status === 'completed') row.completedCount += 1;
      else if (reply?.status === 'failed') row.failedCount += 1;
      else row.pendingOrUnansweredCount += 1;
      turnUsageByNumber.set(turnNumber, row);
    });
  }

  return {
    unit: 'conversation',
    exactness: 'exact_turn_count_from_persisted_web_messages',
    conversationCount: conversationIds.size,
    observedTurnCount,
    conversationLengthDistribution: distributionRows(
      conversationLengthDistribution,
      'conversationCount',
    ),
    turnUsageDistribution: [...turnUsageByNumber.values()].sort(
      (left, right) => left.turnNumber - right.turnNumber,
    ),
    rewriteTelemetry: {
      knownTurnCount: rewriteKnownCount,
      unknownTurnCount: observedTurnCount - rewriteKnownCount,
      coverage: observedTurnCount ? Number((rewriteKnownCount / observedTurnCount).toFixed(4)) : 1,
      source: 'assistant_message.runtime.conversation.requiresContext',
    },
    limitations: [
      'Rewrite usage is unknown for turns whose assistant message lacks persisted conversation runtime telemetry.',
    ],
  };
}

function countCompleteLineTurns(history) {
  const roles = (Array.isArray(history) ? history : [])
    .map((item) => item?.role)
    .filter((role) => role === 'user' || role === 'model');
  let completeTurns = 0;
  let expectedRole = 'user';
  let malformed = false;

  for (const role of roles) {
    if (role !== expectedRole) {
      malformed = true;
      continue;
    }
    if (role === 'model') completeTurns += 1;
    expectedRole = role === 'user' ? 'model' : 'user';
  }

  if (expectedRole === 'model') malformed = true;
  return { completeTurns, malformed };
}

function aggregateLineTurns({ lineUsers = [], recordedQuestionCount = 0, maxConversationTurns } = {}) {
  const parsedLimit = Number(maxConversationTurns);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
    throw new ConversationTurnAnalyticsError(
      'maxConversationTurns must be a positive integer.',
      'CONVERSATION_ANALYTICS_INVALID_LIMIT',
    );
  }

  const retainedLengthDistribution = new Map();
  const turnUsageByNumber = new Map();
  let retainedCompleteTurnCount = 0;
  let atRetentionLimitSnapshotCount = 0;
  let malformedSnapshotCount = 0;

  for (const user of lineUsers) {
    const { completeTurns, malformed } = countCompleteLineTurns(user?.lineConversationHistory);
    increment(retainedLengthDistribution, completeTurns);
    retainedCompleteTurnCount += completeTurns;
    if (completeTurns >= parsedLimit) atRetentionLimitSnapshotCount += 1;
    if (malformed) malformedSnapshotCount += 1;

    for (let turnNumber = 1; turnNumber <= completeTurns; turnNumber += 1) {
      const row = turnUsageByNumber.get(turnNumber) || createTurnUsageRow(turnNumber);
      row.observedTurnCount += 1;
      row.rewriteUnknownCount += 1;
      row.completedCount += 1;
      turnUsageByNumber.set(turnNumber, row);
    }
  }

  return {
    unit: 'bound_user_current_retained_history_snapshot',
    exactness: 'bounded_current_snapshot_not_historical_sessions',
    historyLimitTurns: parsedLimit,
    boundUserSnapshotCount: lineUsers.length,
    retainedCompleteTurnCount,
    recordedQuestionCount: Number.isInteger(recordedQuestionCount) && recordedQuestionCount >= 0
      ? recordedQuestionCount
      : 0,
    recordedQuestionCountIncludedInTurnDistribution: false,
    atRetentionLimitSnapshotCount,
    malformedSnapshotCount,
    retainedLengthDistribution: distributionRows(retainedLengthDistribution, 'userSnapshotCount'),
    turnUsageDistribution: [...turnUsageByNumber.values()].sort(
      (left, right) => left.turnNumber - right.turnNumber,
    ),
    rewriteTelemetry: {
      knownTurnCount: 0,
      unknownTurnCount: retainedCompleteTurnCount,
      coverage: retainedCompleteTurnCount ? 0 : 1,
      source: null,
    },
    limitations: [
      'LINE history has no session identifier, per-message timestamp, turn index, or persisted rewrite-used flag.',
      'LINE history is capped and resets on course changes, so legacy sessions and turns beyond the cap cannot be reconstructed.',
      'This distribution describes only currently retained complete user/model pairs.',
      'Recorded LINE questions cannot be assigned to conversation sessions or turn numbers without inventing missing data.',
    ],
  };
}

function buildConversationTurnAnalytics({
  conversations = [],
  messages = [],
  lineUsers = [],
  recordedLineQuestionCount = 0,
  maxConversationTurns,
  generatedAt = new Date(),
} = {}) {
  return {
    success: true,
    schemaVersion: 'conversation_turn_distribution_v1',
    generatedAt: new Date(generatedAt).toISOString(),
    channels: {
      web: aggregateWebTurns({ conversations, messages }),
      line: aggregateLineTurns({
        lineUsers,
        recordedQuestionCount: recordedLineQuestionCount,
        maxConversationTurns,
      }),
    },
    privacy: {
      conversationTextRead: false,
      conversationTextOutput: false,
      userIdentifiersOutput: false,
      identifiersReadForGrouping: true,
    },
    databaseSafety: {
      mode: 'read_only',
      mongoWrites: 0,
      writeDetected: false,
    },
  };
}

function createCommandMonitor() {
  const state = { mongoReads: 0, mongoWrites: 0 };
  return {
    observe(event = {}) {
      const commandName = String(event.commandName || '').toLowerCase();
      if (WRITE_COMMANDS.has(commandName)) state.mongoWrites += 1;
      else if (READ_COMMANDS.has(commandName)) state.mongoReads += 1;
    },
    assertNoWrites() {
      if (state.mongoWrites) {
        throw new ConversationTurnAnalyticsError(
          'Conversation-turn analytics detected a forbidden MongoDB write command.',
          'CONVERSATION_ANALYTICS_WRITE_DETECTED',
        );
      }
    },
    snapshot() {
      return {
        mongoReads: state.mongoReads,
        mongoWrites: state.mongoWrites,
        writeDetected: state.mongoWrites > 0,
      };
    },
  };
}

function assertStrictReadOnlyRoles(authenticatedUserRoles, databaseName) {
  const roles = Array.isArray(authenticatedUserRoles) ? authenticatedUserRoles : [];
  const expectedDatabase = String(databaseName || '').trim();
  const valid = expectedDatabase
    && roles.length === 1
    && roles[0]?.role === 'read'
    && roles[0]?.db === expectedDatabase;

  if (!valid) {
    throw new ConversationTurnAnalyticsError(
      'Conversation-turn analytics requires a dedicated MongoDB user with only the read role on the target database.',
      'CONVERSATION_ANALYTICS_DATABASE_ROLE_NOT_READ_ONLY',
    );
  }

  return { verified: true, role: 'read', database: expectedDatabase };
}

function createReadOnlyAnalyticsRepository(database, commandMonitor) {
  const assertSafe = () => commandMonitor?.assertNoWrites();
  return {
    async loadWebConversations() {
      const result = await database.collection('conversations').find({}, {
        projection: { _id: 1 },
      }).toArray();
      assertSafe();
      return result;
    },
    async loadWebMessages() {
      const result = await database.collection('messages').find({}, {
        projection: {
          _id: 1,
          conversationId: 1,
          role: 1,
          status: 1,
          replyToMessageId: 1,
          'runtime.conversation.requiresContext': 1,
          createdAt: 1,
        },
      }).sort({ conversationId: 1, createdAt: 1, _id: 1 }).toArray();
      assertSafe();
      return result;
    },
    async loadLineUsers() {
      const result = await database.collection('users').find(
        { lineUserId: { $type: 'string', $ne: '' } },
        { projection: { _id: 0, 'lineConversationHistory.role': 1 } },
      ).toArray();
      assertSafe();
      return result;
    },
    async countRecordedLineQuestions() {
      const result = await database.collection('questions').countDocuments({ source: 'line' });
      assertSafe();
      return result;
    },
  };
}

module.exports = {
  ConversationTurnAnalyticsError,
  WRITE_COMMANDS,
  aggregateLineTurns,
  aggregateWebTurns,
  assertStrictReadOnlyRoles,
  buildConversationTurnAnalytics,
  countCompleteLineTurns,
  createCommandMonitor,
  createReadOnlyAnalyticsRepository,
};
