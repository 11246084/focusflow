const { randomUUID, createHash } = require('node:crypto');
const AppError = require('../utils/appError');
const { assertObjectId } = require('../utils/objectId');
const { TERMS, TERMS_VERSION, KINDS } = require('../constants/recutConsent');

const clone = (value) => JSON.parse(JSON.stringify(value));
const fail = (message, status = 400, code = 'VALIDATION_ERROR') => { throw new AppError(message, status, code); };
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const unavailable = async () => fail('Consent lifecycle integration is unavailable.', 503, 'RECUT_CONSENT_LIFECYCLE_UNAVAILABLE');
const METHODS = ['listAssets', 'stopWork', 'archiveAsset', 'makeYouTubePrivate', 'listAdmins', 'notifyAdmin'];

function createRecutConsentService({ repository, lifecycle = {}, now = () => new Date(), leaseMs = 30000 } = {}) {
  let actions = Object.fromEntries(METHODS.map((name) => [name, lifecycle[name] || unavailable]));
  const timestamp = () => new Date(now()).toISOString();
  function configureLifecycle(adapter) {
    if (!adapter || METHODS.some((name) => typeof adapter[name] !== 'function')) {
      fail('All consent lifecycle methods are required.');
    }
    actions = Object.fromEntries(METHODS.map((name) => [name, adapter[name].bind(adapter)]));
  }
  const repo = () => repository || (repository = require('./recutConsent.repository').createMongoRepository());
  async function mutate(teacherId, update) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const before = await repo().read(teacherId);
      const mutation = await update(clone(before));
      if (!mutation) return before;
      if (await repo().commit(before, mutation)) return repo().read(teacherId);
    }
    fail('Consent changed concurrently. Retry the request.', 409, 'RECUT_CONSENT_CONFLICT');
  }
  async function authorize(input) {
    const { user, courseId, videoId, sourceId } = input;
    if (!user?.id) fail('Authentication required.', 401, 'UNAUTHORIZED');
    assertObjectId(courseId, 'course');
    const course = await repo().getCourse(courseId);
    if (!course || course.deletedAt) fail('Course not found.', 404, 'COURSE_NOT_FOUND');
    const teacherId = String(course.teacherId?._id || course.teacherId);
    if (user.role !== 'admin' && !(user.role === 'teacher' && String(user.id) === teacherId)) {
      fail('You cannot manage this teacher consent.', 403, 'COURSE_MANAGE_DENIED');
    }
    if (input.teacherId && String(input.teacherId) !== teacherId) fail('Teacher does not own this course.', 403, 'COURSE_MANAGE_DENIED');
    const source = await validateSource({ courseId: String(courseId), videoId, sourceId });
    return { teacherId, courseId: String(courseId), ...source };
  }
  async function validateSource({ courseId, videoId, sourceId }) {
    let video;
    if (videoId) {
      assertObjectId(videoId, 'video');
      video = await repo().getVideo(videoId);
      if (!video || video.deletedAt || String(video.courseId) !== String(courseId)) fail('Video is not in this course.', 404, 'VIDEO_NOT_FOUND');
    }
    if (sourceId != null) {
      if (typeof sourceId !== 'string' || !sourceId.trim() || sourceId.length > 256 || sourceId !== sourceId.trim()) fail('Invalid sourceId.');
      const source = video && String(video.videoId) === sourceId ? video : await repo().getSource(sourceId, courseId);
      if (!source || source.deletedAt || String(source.courseId) !== String(courseId)
        || (videoId && String(source._id) !== String(videoId))) fail('Source is not in this course.', 404, 'VIDEO_NOT_FOUND');
      video = source;
    }
    return { videoId: video ? String(video._id) : null, sourceId: video?.videoId || sourceId || null };
  }
  function validateKind(kind) { if (!KINDS.includes(kind)) fail('Invalid consent kind.'); }
  function requestKey(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) fail('A valid requestId is required.');
    return value;
  }
  function scopeFor(scope, kind) {
    return kind === 'content' ? { ...scope, kind } : { teacherId: scope.teacherId, kind, courseId: null, videoId: null, sourceId: null };
  }
  function latest(state, scope, kind) {
    return [...state.records].reverse().find((record) => record.kind === kind && (
      kind !== 'content' || (String(record.courseId) === String(scope.courseId)
        && (!record.videoId || String(record.videoId) === String(scope.videoId))
        && (!record.sourceId || record.sourceId === scope.sourceId))
    )) || null;
  }
  function duplicate(state, requestId, digest) {
    const prior = state.records.find((record) => record.requestId === requestId);
    if (prior && prior.fingerprint !== digest) fail('requestId was already used for different consent data.', 409, 'RECUT_CONSENT_IDEMPOTENCY_CONFLICT');
    return prior;
  }
  function view(state, scope) {
    const decisions = Object.fromEntries(KINDS.map((kind) => [kind, latest(state, scope, kind)]));
    return { teacherId: scope.teacherId, scope, revision: state.revision, decisions,
      voiceMode: decisions.voice?.choice === 'original' ? 'original' : decisions.voice?.choice === 'synthetic' ? 'synthetic' : null,
      syntheticReady: false, termsVersion: TERMS_VERSION };
  }
  async function getConsent(input) {
    const scope = await authorize(input);
    return view(await repo().read(scope.teacherId), scope);
  }
  async function recordConsent(input) {
    const scope = await authorize(input);
    const { kind, choice, termsVersion, evidenceRef } = input;
    validateKind(kind);
    if (termsVersion !== TERMS_VERSION) fail('Read and accept the current terms version.', 409, 'RECUT_CONSENT_TERMS_OUTDATED');
    if (!(kind === 'voice' ? ['original', 'synthetic'] : ['granted', 'declined']).includes(choice)) fail('Invalid consent choice.');
    if (evidenceRef != null && (input.user.role !== 'admin' || typeof evidenceRef !== 'string' || !evidenceRef.trim() || evidenceRef.length > 500)) fail('Only an administrator may register a bounded evidence reference.');
    const requestId = requestKey(input.requestId);
    const target = scopeFor(scope, kind);
    const digest = fingerprint({ target, choice, termsVersion, evidenceRef: evidenceRef || null });
    const state = await mutate(scope.teacherId, (before) => {
      if (duplicate(before, requestId, digest)) return null;
      if (before.withdrawals.some((item) => item.kind === kind && item.status !== 'completed')) {
        fail('Resolve pending withdrawal actions before changing this consent.', 409, 'RECUT_CONSENT_WITHDRAWAL_PENDING');
      }
      return { withdrawals: before.withdrawals, record: { ...target, id: randomUUID(), requestId, fingerprint: digest,
        actorId: String(input.user.id), choice, termsVersion, recordedAt: timestamp(), evidenceRef: evidenceRef || null } };
    });
    return view(state, scope);
  }
  // Internal gate. Course ownership is derived from the current Course, not caller supplied teacherId.
  async function assertConsentForWork(input) {
    assertObjectId(input.courseId, 'course');
    const course = await repo().getCourse(input.courseId);
    if (!course || course.deletedAt) fail('Course not found.', 404, 'COURSE_NOT_FOUND');
    const teacherId = String(course.teacherId?._id || course.teacherId);
    if (input.teacherId && String(input.teacherId) !== teacherId) fail('Consent teacher mismatch.', 403, 'COURSE_MANAGE_DENIED');
    const source = await validateSource(input);
    const scope = { ...input, ...source, teacherId };
    const state = await repo().read(teacherId);
    if (latest(state, scope, 'content')?.choice !== 'granted') fail('Content consent is required.', 409, 'RECUT_CONTENT_CONSENT_REQUIRED');
    if (input.contentOnly) return { teacherId, revision: state.revision, termsVersion: TERMS_VERSION };
    if (input.avatar) {
      for (const kind of ['avatarLikeness', 'voiceClone']) {
        if (latest(state, scope, kind)?.choice !== 'granted') fail(`${kind} consent is required.`, 409, 'RECUT_AVATAR_CONSENT_REQUIRED');
      }
    } else {
      const choice = latest(state, scope, 'voice')?.choice;
      const voiceMode = input.voiceMode || (choice === 'original' ? 'original' : choice === 'synthetic' ? 'synthetic' : null);
      if (!voiceMode || choice !== voiceMode) fail('Choose the teacher voice preference first.', 409, 'RECUT_VOICE_CONSENT_REQUIRED');
      // RC12 is a separate delivery; a caller cannot override readiness using request input.
      if (voiceMode === 'synthetic') fail('Synthetic voice is not ready. Original audio will not be used.', 503, 'RECUT_SYNTHETIC_VOICE_NOT_READY');
    }
    return { teacherId, revision: state.revision, termsVersion: TERMS_VERSION };
  }
  async function listWithdrawalAssets(input) {
    const scope = await authorize(input);
    validateKind(input.kind);
    const target = scopeFor(scope, input.kind);
    const assets = await actions.listAssets(target);
    return { scope: target, assets: assets.map((asset) => ({ ...asset, id: String(asset.id || asset._id), selected: false })), selectAll: false };
  }
  async function updateWithdrawal(teacherId, withdrawalId, operation) {
    return mutate(teacherId, (before) => {
      const withdrawal = before.withdrawals.find((item) => item.id === withdrawalId);
      if (!withdrawal) fail('Withdrawal not found.', 404, 'RECUT_WITHDRAWAL_NOT_FOUND');
      if (operation(withdrawal) === false) return null;
      return { withdrawals: before.withdrawals };
    });
  }
  async function processWithdrawal(teacherId, withdrawalId) {
    const token = randomUUID();
    let state = await updateWithdrawal(teacherId, withdrawalId, (item) => {
      if (item.status === 'completed' || (item.leaseUntil && new Date(item.leaseUntil).getTime() > new Date(now()).getTime())) return false;
      item.leaseToken = token;
      item.leaseUntil = new Date(new Date(now()).getTime() + leaseMs).toISOString();
      item.status = 'processing';
    });
    let job = state.withdrawals.find((item) => item.id === withdrawalId);
    if (job.leaseToken !== token) return clone(job);
    const context = { withdrawalId, actorId: job.actorId };
    const save = async (operation) => {
      state = await updateWithdrawal(teacherId, withdrawalId, (item) => {
        if (item.leaseToken !== token) return false;
        operation(item);
        if (item.leaseToken === token) item.leaseUntil = new Date(new Date(now()).getTime() + leaseMs).toISOString();
      });
      job = state.withdrawals.find((item) => item.id === withdrawalId);
      return job.leaseToken === token;
    };
    // The action ID is stable across retries/restarts. Integrations must dedupe on it.
    for (const planned of job.actions.filter((item) => item.type !== 'notifyAdmin')) {
      if (planned.status === 'completed') continue;
      if (!(await save(() => {}))) return clone(job);
      try {
        const actionContext = { ...context, operationId: planned.id };
        if (planned.type === 'stopWork') await actions.stopWork(job.scope, actionContext);
        if (planned.type === 'archiveAsset') await actions.archiveAsset(planned.assetId, job.scope, actionContext);
        if (planned.type === 'makeYouTubePrivate') await actions.makeYouTubePrivate(planned.assetId, job.scope, actionContext);
        if (planned.type === 'notifyAdmin') await actions.notifyAdmin(planned.adminId, {
          withdrawalId, assetId: planned.assetId, teacherId, message: '短片撤回後轉私人失敗，請手動下架。',
        }, actionContext);
        await save((item) => {
          const action = item.actions.find((candidate) => candidate.id === planned.id);
          Object.assign(action, { status: 'completed', manualActionRequired: false, completedAt: timestamp(), errorCode: null });
        });
      } catch (error) {
        await save((item) => {
          const action = item.actions.find((candidate) => candidate.id === planned.id);
          Object.assign(action, { status: 'failed', attempts: (action.attempts || 0) + 1,
            errorCode: /^[A-Z0-9_]{1,100}$/.test(error.code || '') ? error.code : 'RECUT_WITHDRAWAL_ACTION_FAILED',
            failedAt: timestamp(), manualActionRequired: action.type === 'makeYouTubePrivate' });
        });
      }
    }
    // Persist the admin recipient list before sending anything. Enumeration failures remain retryable.
    const failedPrivacy = job.actions.filter((item) => item.type === 'makeYouTubePrivate' && item.status === 'failed');
    if (!failedPrivacy.length && job.adminEnumerationError) await save((item) => { item.adminEnumerationError = false; });
    if (failedPrivacy.length && !job.admins) {
      try {
        const admins = await actions.listAdmins();
        await save((item) => {
          item.admins = admins.map((admin) => String(admin.id || admin._id || admin));
          item.adminEnumerationError = false;
        });
      } catch {
        await save((item) => { item.adminEnumerationError = true; });
      }
    }
    if (job.admins) {
      await save((item) => {
        for (const privacy of failedPrivacy) for (const adminId of item.admins) {
          const id = `${privacy.id}:admin:${adminId}`;
          if (!item.actions.some((action) => action.id === id)) item.actions.push({ id, type: 'notifyAdmin', adminId, assetId: privacy.assetId, status: 'pending' });
        }
      });
      for (const action of job.actions.filter((item) => item.type === 'notifyAdmin' && item.status !== 'completed')) {
        if (!(await save(() => {}))) return clone(job);
        try {
          await actions.notifyAdmin(action.adminId, { withdrawalId, assetId: action.assetId, teacherId,
            message: '短片撤回後轉私人失敗，請手動下架。' }, { ...context, operationId: action.id });
          await save((item) => { item.actions.find((candidate) => candidate.id === action.id).status = 'completed'; });
        } catch {
          await save((item) => { item.actions.find((candidate) => candidate.id === action.id).status = 'failed'; });
        }
      }
    }
    await save((item) => {
      item.status = item.actions.every((action) => action.status === 'completed') && !item.adminEnumerationError ? 'completed' : 'pending';
      item.leaseToken = null;
      item.leaseUntil = null;
    });
    return clone(job);
  }
  async function withdraw(input) {
    const scope = await authorize(input);
    const { kind, termsVersion } = input;
    validateKind(kind);
    if (termsVersion !== TERMS_VERSION) fail('Current termsVersion is required.', 409, 'RECUT_CONSENT_TERMS_OUTDATED');
    const requestId = requestKey(input.requestId);
    const ids = input.selectedAssetIds === undefined ? [] : input.selectedAssetIds;
    if (!Array.isArray(ids) || ids.length > 1000 || ids.some((id) => typeof id !== 'string')) fail('Invalid selectedAssetIds.');
    ids.forEach((id) => assertObjectId(id, 'short asset'));
    if (input.selectAll !== undefined && typeof input.selectAll !== 'boolean') fail('selectAll must be a boolean.');
    if (input.selectAll && ids.length) fail('Use selectedAssetIds or selectAll.');
    const target = scopeFor(scope, kind);
    const digest = fingerprint({ target, choice: 'withdrawn', termsVersion, selectedAssetIds: [...new Set(ids)].sort(), selectAll: input.selectAll === true });
    const before = await repo().read(scope.teacherId);
    const prior = duplicate(before, requestId, digest);
    if (prior) return processWithdrawal(scope.teacherId, prior.id);
    const available = await actions.listAssets(target);
    const availableIds = available.map((asset) => String(asset.id || asset._id));
    const selected = input.selectAll ? availableIds : [...new Set(ids)];
    if (selected.some((id) => !availableIds.includes(id))) fail('Selected asset is outside the consent scope.', 403, 'RECUT_WITHDRAWAL_ASSET_DENIED');
    const id = randomUUID();
    const recordedAt = timestamp();
    const state = await mutate(scope.teacherId, (current) => {
      if (duplicate(current, requestId, digest)) return null;
      const job = { id, requestId, teacherId: scope.teacherId, actorId: String(input.user.id), kind, scope: target,
        courseId: scope.courseId, status: 'pending', createdAt: recordedAt, selectedAssetIds: selected,
        actions: [{ id: `${id}:stop`, type: 'stopWork', status: 'pending' }, ...selected.flatMap((assetId) => [
          { id: `${id}:archive:${assetId}`, type: 'archiveAsset', assetId, status: 'pending' },
          { id: `${id}:private:${assetId}`, type: 'makeYouTubePrivate', assetId, status: 'pending' },
        ])] };
      return { record: { ...target, id, requestId, fingerprint: digest, actorId: String(input.user.id), choice: 'withdrawn', termsVersion, recordedAt },
        withdrawals: [...current.withdrawals, job] };
    });
    return processWithdrawal(scope.teacherId, duplicate(state, requestId, digest).id);
  }
  async function retryWithdrawal(input) {
    const scope = await authorize(input);
    const state = await repo().read(scope.teacherId);
    const job = state.withdrawals.find((item) => item.id === input.withdrawalId);
    if (!job || (job.kind === 'content' && String(job.scope.courseId) !== scope.courseId)) fail('Withdrawal not found.', 404, 'RECUT_WITHDRAWAL_NOT_FOUND');
    return processWithdrawal(scope.teacherId, job.id);
  }
  async function recoverPendingWithdrawals() {
    const states = await repo().listPending();
    const results = [];
    for (const state of states) for (const job of state.withdrawals) {
      if (job.status !== 'completed') results.push(await processWithdrawal(String(state.teacherId), job.id));
    }
    return results;
  }
  async function listManualActions({ user }) {
    if (user?.role !== 'admin') fail('Administrator access required.', user?.id ? 403 : 401, user?.id ? 'FORBIDDEN' : 'UNAUTHORIZED');
    const states = await repo().listManualActions();
    return states.flatMap((state) => state.withdrawals.flatMap((job) => job.actions.filter((action) => action.manualActionRequired)
      .map((action) => ({ ...action, teacherId: String(state.teacherId), withdrawalId: job.id, courseId: job.courseId }))));
  }
  return { getTerms: () => TERMS, configureLifecycle, getConsent, recordConsent, assertConsentForWork,
    listWithdrawalAssets, withdraw, retryWithdrawal, recoverPendingWithdrawals, listManualActions };
}

module.exports = { createRecutConsentService, ...createRecutConsentService() };
