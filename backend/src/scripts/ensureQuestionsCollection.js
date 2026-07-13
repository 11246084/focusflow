const mongoose = require('mongoose');
const { connectDatabase } = require('../config/database');
const Question = require('../models/question.model');

async function main() {
  await connectDatabase();

  const collectionName = Question.collection.name;
  await Question.createCollection();
  const result = await Question.syncIndexes();

  console.log(JSON.stringify({
    collection: collectionName,
    syncedIndexes: result,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error('ensureQuestionsCollection failed:', error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
