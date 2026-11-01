'use strict';

// Importing this entrypoint does not load settings, providers, media tools or a DB.
// The host supplies adapters explicitly; construction never starts processing.
function createRecutApplication({ runtimeAdapters = {}, queue, beforeEnqueue, checkWork } = {}) {
  const AppError = require('../utils/appError');
  const { recutQueue } = require('./recutQueue.service');
  const { getSetting: fallbackSetting } = require('./recutSettings.service');
  const targetQueue = queue || recutQueue;
  const missing = new Set(runtimeAdapters.missing || []);
  if (typeof runtimeAdapters.decide !== 'function') missing.add('provider');
  const renderer = runtimeAdapters.renderer;
  for (const method of ['buildRecutPlan', 'validatePlan', 'getComponentCatalog']) {
    if (typeof renderer?.[method] !== 'function') missing.add(`renderer.${method}`);
  }
  if (!runtimeAdapters.sourceSteps) for (const method of ['probe', 'decode', 'measure', 'transcribe']) {
    if (typeof runtimeAdapters.sourceOptions?.media?.[method] !== 'function') missing.add(`media.${method}`);
  }
  function assertConfigured() {
    if (missing.size) throw new AppError(`Recut 尚缺必要轉接：${[...missing].join(', ')}`, 503,
      'RECUT_STEPS_NOT_CONFIGURED', { missing: [...missing] });
  }
  const getSetting = runtimeAdapters.getSetting || fallbackSetting;
  const restoreRuntime = targetQueue.configureRuntime({ getSetting,
    captureSettings: runtimeAdapters.captureSettings || (() => ({ model: getSetting('recut.geminiModel') })),
    beforeEnqueue: async (request) => { assertConfigured();
      await require('./recutWorkConsent.service').assertScriptConsent(request.script); await beforeEnqueue?.(request); },
    ...(checkWork ? { checkWork } : {}),
  });
  let pipeline = null;
  if (!missing.size) {
    pipeline = require('./recutPipeline.service').createRecutPipeline(runtimeAdapters);
    pipeline.register(targetQueue);
  }
  return { queue: targetQueue, pipeline, missing: [...missing], assertConfigured,
    generation: require('./recut.service').createRecutService({ queue: targetQueue }),
    review: require('./recutReview.service').createRecutReviewService({ queue: targetQueue }),
    recover: () => { assertConfigured(); return targetQueue.recover(); },
    stop: () => targetQueue.stop(),
    dispose: async () => { await targetQueue.idle(); restoreRuntime(); },
  };
}
let configuredApplication;
function configureRecutApplication(options) {
  configuredApplication = createRecutApplication(options);
  return configuredApplication;
}
function getRecutApplication() {
  return configuredApplication || configureRecutApplication();
}
module.exports = { createRecutApplication, configureRecutApplication, getRecutApplication };
