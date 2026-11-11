'use strict';
const { createRecutCardsStep } = require('./recutCards.service');
const { createRecutWholeCheckStep } = require('./recutWholeCheck.service');

// Construction is inert. Registration is explicit and never silently chooses a
// provider or starts a database, media process, server, or rendering worker.
function createRecutPipeline({ decide, renderer, sourceOptions, loadSource, loadBaseVersion, codeCardHandler, courseTerms, sourceSteps, selectionStep } = {}) {
  if (typeof decide !== 'function') throw new TypeError('An explicit recut decision provider is required.');
  const selection = selectionStep || { id: 'recut-selection-v1', stage: 'selection', run: (context) => {
    const { createRecutSelectionStep } = require('./recutSelection.service');
    return createRecutSelectionStep({ decide: (request) => decide({ ...request,
      input: { ...request.input, ...(context.data.repairIssues ? { errors: context.data.repairIssues } : {}) } }) }).run(context);
  } };
  const cards = createRecutCardsStep({ decide, renderer, loadSource, loadBaseVersion, codeCardHandler, courseTerms });
  const wholeCheck = createRecutWholeCheckStep({ decide, renderer, cards, selection, loadSource });
  const generate = [...(sourceSteps || []), selection, cards, wholeCheck];
  return { cards, wholeCheck, generate, register(queue) {
    if (!queue?.registerSteps) throw new TypeError('Provide a recut queue.');
    const sources = sourceSteps || require('./recutSource.service').createRecutSourceSteps(sourceOptions);
    queue.registerSteps('generate', [...sources, selection, cards, wholeCheck]);
    require('./recutReviewSteps.service').registerRecutReviewSteps({ cards, wholeCheck }, queue);
    return { cards, wholeCheck };
  } };
}
module.exports = { createRecutPipeline };
