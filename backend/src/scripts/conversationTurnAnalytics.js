const mongoose = require('mongoose');
const env = require('../config/env');
const {
  ConversationTurnAnalyticsError,
  assertStrictReadOnlyRoles,
  buildConversationTurnAnalytics,
  createCommandMonitor,
  createReadOnlyAnalyticsRepository,
} = require('../services/conversationTurnAnalytics.service');

function parseCliArgs(argv = []) {
  const options = { maxConversationTurns: env.maxConversationTurns };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--max-turns') {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 1) {
        throw new ConversationTurnAnalyticsError(
          '--max-turns must be a positive integer.',
          'CONVERSATION_ANALYTICS_CLI_INVALID',
        );
      }
      options.maxConversationTurns = value;
      index += 1;
    } else if (flag === '--json') {
      // JSON is the only output format; retain an explicit flag for scripting clarity.
    } else {
      throw new ConversationTurnAnalyticsError(
        `Unknown argument: ${flag}`,
        'CONVERSATION_ANALYTICS_CLI_INVALID',
      );
    }
  }
  return options;
}

async function createReadOnlyConnection(uri, commandMonitor) {
  const connection = await mongoose.createConnection(uri, {
    autoCreate: false,
    autoIndex: false,
    monitorCommands: true,
    readPreference: 'secondaryPreferred',
    retryWrites: false,
    serverSelectionTimeoutMS: 10000,
  }).asPromise();
  connection.getClient().on('commandStarted', (event) => commandMonitor.observe(event));
  return connection;
}

async function runLiveAnalytics(options = {}, dependencies = {}) {
  const uri = String(
    dependencies.uri ?? process.env.CONVERSATION_ANALYTICS_READONLY_MONGODB_URI ?? '',
  ).trim();
  if (!uri) {
    throw new ConversationTurnAnalyticsError(
      'CONVERSATION_ANALYTICS_READONLY_MONGODB_URI is required.',
      'CONVERSATION_ANALYTICS_READONLY_URI_REQUIRED',
    );
  }

  const commandMonitor = dependencies.commandMonitor || createCommandMonitor();
  const connectionFactory = dependencies.connectionFactory || createReadOnlyConnection;
  const connection = await connectionFactory(uri, commandMonitor);

  try {
    const connectionStatus = await connection.db.admin().command({
      connectionStatus: 1,
      showPrivileges: false,
    });
    const databaseAccess = assertStrictReadOnlyRoles(
      connectionStatus?.authInfo?.authenticatedUserRoles,
      connection.name,
    );
    commandMonitor.assertNoWrites();

    const repositoryFactory = dependencies.repositoryFactory || createReadOnlyAnalyticsRepository;
    const repository = repositoryFactory(connection.db, commandMonitor);
    const [conversations, messages, lineUsers, recordedLineQuestionCount] = await Promise.all([
      repository.loadWebConversations(),
      repository.loadWebMessages(),
      repository.loadLineUsers(),
      repository.countRecordedLineQuestions(),
    ]);
    commandMonitor.assertNoWrites();

    const result = buildConversationTurnAnalytics({
      conversations,
      messages,
      lineUsers,
      recordedLineQuestionCount,
      maxConversationTurns: options.maxConversationTurns,
      generatedAt: dependencies.generatedAt || new Date(),
    });
    result.databaseSafety = {
      mode: 'strict_read_only_role_and_command_monitoring',
      databaseAccess,
      ...commandMonitor.snapshot(),
    };
    return result;
  } finally {
    await connection.close();
  }
}

function safeFailure(error) {
  return {
    success: false,
    code: error instanceof ConversationTurnAnalyticsError
      ? error.code
      : 'CONVERSATION_ANALYTICS_FAILED',
    message: error instanceof ConversationTurnAnalyticsError
      ? error.message
      : 'Conversation-turn analytics failed safely.',
  };
}

async function main(argv = process.argv.slice(2)) {
  try {
    const options = parseCliArgs(argv);
    const result = await runLiveAnalytics(options);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(JSON.stringify(safeFailure(error)));
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  createReadOnlyConnection,
  main,
  parseCliArgs,
  runLiveAnalytics,
  safeFailure,
};
