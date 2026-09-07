const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  ConversationTurnAnalyticsError,
  aggregateLineTurns,
  aggregateWebTurns,
  assertStrictReadOnlyRoles,
  buildConversationTurnAnalytics,
  createCommandMonitor,
  createReadOnlyAnalyticsRepository,
} = require('../src/services/conversationTurnAnalytics.service');
const {
  parseCliArgs,
  runLiveAnalytics,
  safeFailure,
} = require('../src/scripts/conversationTurnAnalytics');

const date = (minute) => `2026-09-07T00:${String(minute).padStart(2, '0')}:00.000Z`;

describe('conversation-turn analytics', () => {
  it('分開統計 Web conversation 長度、實際輪次與追問改寫', () => {
    const result = aggregateWebTurns({
      conversations: [{ _id: 'conversation-a' }, { _id: 'conversation-b' }, { _id: 'empty' }],
      messages: [
        { _id: 'a-user-1', conversationId: 'conversation-a', role: 'user', content: 'private-a1', createdAt: date(1) },
        { _id: 'a-model-1', conversationId: 'conversation-a', role: 'assistant', status: 'completed', replyToMessageId: 'a-user-1', runtime: { conversation: { requiresContext: false } }, createdAt: date(2) },
        { _id: 'a-user-2', conversationId: 'conversation-a', role: 'user', content: 'private-a2', createdAt: date(3) },
        { _id: 'a-model-2', conversationId: 'conversation-a', role: 'assistant', status: 'completed', replyToMessageId: 'a-user-2', runtime: { conversation: { requiresContext: true } }, createdAt: date(4) },
        { _id: 'b-user-1', conversationId: 'conversation-b', role: 'user', content: 'private-b1', createdAt: date(5) },
        { _id: 'b-model-1', conversationId: 'conversation-b', role: 'assistant', status: 'failed', replyToMessageId: 'b-user-1', createdAt: date(6) },
        { _id: 'orphan-user', conversationId: 'missing', role: 'user', createdAt: date(7) },
      ],
    });

    assert.equal(result.conversationCount, 3);
    assert.equal(result.observedTurnCount, 3);
    assert.deepEqual(result.conversationLengthDistribution, [
      { turns: 0, conversationCount: 1 },
      { turns: 1, conversationCount: 1 },
      { turns: 2, conversationCount: 1 },
    ]);
    assert.deepEqual(result.turnUsageDistribution, [
      {
        turnNumber: 1,
        observedTurnCount: 2,
        rewriteUsedCount: 0,
        rewriteNotUsedCount: 1,
        rewriteUnknownCount: 1,
        completedCount: 1,
        failedCount: 1,
        pendingOrUnansweredCount: 0,
      },
      {
        turnNumber: 2,
        observedTurnCount: 1,
        rewriteUsedCount: 1,
        rewriteNotUsedCount: 0,
        rewriteUnknownCount: 0,
        completedCount: 1,
        failedCount: 0,
        pendingOrUnansweredCount: 0,
      },
    ]);
    assert.deepEqual(result.rewriteTelemetry, {
      knownTurnCount: 2,
      unknownTurnCount: 1,
      coverage: 0.6667,
      source: 'assistant_message.runtime.conversation.requiresContext',
    });
  });

  it('LINE 只統計目前保留的完整 user/model 配對並標記 legacy 限制', () => {
    const result = aggregateLineTurns({
      maxConversationTurns: 2,
      recordedQuestionCount: 19,
      lineUsers: [
        { lineConversationHistory: [] },
        { lineConversationHistory: [{ role: 'user' }, { role: 'model' }] },
        { lineConversationHistory: [
          { role: 'user' }, { role: 'model' }, { role: 'user' }, { role: 'model' },
        ] },
        { lineConversationHistory: [{ role: 'user' }] },
      ],
    });

    assert.equal(result.exactness, 'bounded_current_snapshot_not_historical_sessions');
    assert.equal(result.boundUserSnapshotCount, 4);
    assert.equal(result.retainedCompleteTurnCount, 3);
    assert.equal(result.recordedQuestionCount, 19);
    assert.equal(result.recordedQuestionCountIncludedInTurnDistribution, false);
    assert.equal(result.atRetentionLimitSnapshotCount, 1);
    assert.equal(result.malformedSnapshotCount, 1);
    assert.deepEqual(result.retainedLengthDistribution, [
      { turns: 0, userSnapshotCount: 2 },
      { turns: 1, userSnapshotCount: 1 },
      { turns: 2, userSnapshotCount: 1 },
    ]);
    assert.equal(result.rewriteTelemetry.knownTurnCount, 0);
    assert.equal(result.rewriteTelemetry.unknownTurnCount, 3);
    assert.match(result.limitations.join(' '), /cannot be reconstructed/);
  });

  it('輸出不包含對話文字或使用者／conversation 識別碼', () => {
    const result = buildConversationTurnAnalytics({
      generatedAt: '2026-09-07T01:00:00.000Z',
      maxConversationTurns: 4,
      conversations: [{ _id: 'sensitive-conversation-id', userId: 'sensitive-user-id' }],
      messages: [
        { _id: 'sensitive-message-id', conversationId: 'sensitive-conversation-id', role: 'user', content: 'secret-question', createdAt: date(1) },
        { _id: 'reply', conversationId: 'sensitive-conversation-id', role: 'assistant', content: 'secret-answer', status: 'completed', replyToMessageId: 'sensitive-message-id', runtime: { conversation: { requiresContext: false } }, createdAt: date(2) },
      ],
      lineUsers: [{
        _id: 'sensitive-line-user-id',
        lineUserId: 'sensitive-line-id',
        lineConversationHistory: [
          { role: 'user', content: 'secret-line-question' },
          { role: 'model', content: 'secret-line-answer' },
        ],
      }],
    });
    const output = JSON.stringify(result);

    for (const secret of [
      'secret-question', 'secret-answer', 'secret-line-question', 'secret-line-answer',
      'sensitive-user-id', 'sensitive-conversation-id', 'sensitive-line-id',
    ]) {
      assert.equal(output.includes(secret), false);
    }
    assert.deepEqual(result.privacy, {
      conversationTextRead: false,
      conversationTextOutput: false,
      userIdentifiersOutput: false,
      identifiersReadForGrouping: true,
    });
  });

  it('唯讀 repository projection 不讀取 question、answer 或 message content', async () => {
    const calls = [];
    const cursor = {
      sort(value) { calls.push({ operation: 'sort', value }); return this; },
      async toArray() { return []; },
    };
    const database = {
      collection(name) {
        return {
          find(filter, options) { calls.push({ operation: 'find', name, filter, options }); return cursor; },
          async countDocuments(filter) { calls.push({ operation: 'countDocuments', name, filter }); return 0; },
        };
      },
    };
    const repository = createReadOnlyAnalyticsRepository(database, createCommandMonitor());
    await repository.loadWebConversations();
    await repository.loadWebMessages();
    await repository.loadLineUsers();
    await repository.countRecordedLineQuestions();

    const serializedCalls = JSON.stringify(calls);
    assert.equal(serializedCalls.includes('"content"'), false);
    assert.equal(serializedCalls.includes('"question"'), false);
    assert.equal(serializedCalls.includes('"answer"'), false);
    const usersCall = calls.find((call) => call.operation === 'find' && call.name === 'users');
    assert.deepEqual(usersCall.options.projection, {
      _id: 0,
      'lineConversationHistory.role': 1,
    });
  });

  it('拒絕非專用 read role 並攔截任何 MongoDB write command', () => {
    assert.deepEqual(assertStrictReadOnlyRoles(
      [{ role: 'read', db: 'focusflow' }],
      'focusflow',
    ), { verified: true, role: 'read', database: 'focusflow' });
    assert.throws(
      () => assertStrictReadOnlyRoles([{ role: 'readWrite', db: 'focusflow' }], 'focusflow'),
      (error) => error.code === 'CONVERSATION_ANALYTICS_DATABASE_ROLE_NOT_READ_ONLY',
    );

    const monitor = createCommandMonitor();
    monitor.observe({ commandName: 'find' });
    monitor.observe({ commandName: 'update' });
    assert.deepEqual(monitor.snapshot(), { mongoReads: 1, mongoWrites: 1, writeDetected: true });
    assert.throws(
      () => monitor.assertNoWrites(),
      (error) => error.code === 'CONVERSATION_ANALYTICS_WRITE_DETECTED',
    );
  });

  it('CLI 只接受正整數上限且 live runner 使用注入的唯讀資料', async () => {
    assert.deepEqual(parseCliArgs(['--json', '--max-turns', '6']), { maxConversationTurns: 6 });
    assert.throws(
      () => parseCliArgs(['--max-turns', '0']),
      (error) => error.code === 'CONVERSATION_ANALYTICS_CLI_INVALID',
    );

    let closed = false;
    const commandMonitor = createCommandMonitor();
    const result = await runLiveAnalytics(
      { maxConversationTurns: 4 },
      {
        uri: 'mongodb://redacted/focusflow',
        generatedAt: '2026-09-07T02:00:00.000Z',
        commandMonitor,
        connectionFactory: async () => ({
          name: 'focusflow',
          db: {
            admin: () => ({
              command: async () => ({
                authInfo: { authenticatedUserRoles: [{ role: 'read', db: 'focusflow' }] },
              }),
            }),
          },
          close: async () => { closed = true; },
        }),
        repositoryFactory: () => ({
          loadWebConversations: async () => [{ _id: 'web-1' }],
          loadWebMessages: async () => [],
          loadLineUsers: async () => [],
          countRecordedLineQuestions: async () => 7,
        }),
      },
    );

    assert.equal(closed, true);
    assert.equal(result.channels.web.conversationCount, 1);
    assert.equal(result.channels.line.recordedQuestionCount, 7);
    assert.deepEqual(result.databaseSafety, {
      mode: 'strict_read_only_role_and_command_monitoring',
      databaseAccess: { verified: true, role: 'read', database: 'focusflow' },
      mongoReads: 0,
      mongoWrites: 0,
      writeDetected: false,
    });
    assert.deepEqual(safeFailure(new ConversationTurnAnalyticsError('safe', 'SAFE')), {
      success: false,
      code: 'SAFE',
      message: 'safe',
    });
  });
});
