// 決策「階段與檢查」的唯一程式對照。此檔只描述規則，不呼叫任何工具。
const RECUT_STAGES = Object.freeze(Object.fromEntries(Object.entries({
  sourceCheck: { location: 'vm', checks: ['audioTrack', 'windowDuration', 'decodable', 'loudness', 'truePeak', 'fixedGain'], failureTarget: 'stop' },
  selection: { location: 'backend+gemini', checks: ['sentenceLabels', 'sentenceRanges', 'duration30To65', 'answerable'], failureTarget: 'selection' },
  cards: { location: 'backend+gemini', checks: ['cardDuration3To12', 'sentenceBoundaries', 'subtitleSource'], failureTarget: 'cards' },
  wholeCheck: { location: 'gemini+backend', checks: ['credibility', 'quality'], failureTarget: { credibility: ['selection', 'cards'], quality: 'suggestionsWhenBudgetExhausted' } },
  scriptReview: { location: 'teacherBrowser', checks: ['currentScriptApproval', 'noPendingEdits', 'noActiveTask'], failureTarget: 'scriptReview' },
  render: { location: 'worker', checks: ['lease', 'heartbeat', 'renderTracks', 'renderDuration', 'blackFrames', 'silence', 'renderLoudness', 'fontLoaded', 'versionsMatch'], failureTarget: { intermittent: 'renderOtherWorker', deterministic: 'renderFailed' } },
  assetReview: { location: 'teacher', checks: ['currentMp4Approval'], failureTarget: 'existingAssetReview' },
}).map(([key, value]) => [key, Object.freeze({ ...value, checks: Object.freeze(value.checks) })])));

const PRODUCTION_MODES = Object.freeze({ AVATAR: 'avatar', RECUT: 'recut' });
const RECUT_STATES = Object.freeze({
  IDLE: 'idle', QUEUED: 'queued', GENERATING: 'generating', UPDATING: 'updating',
  SCRIPT_REVIEW: 'script_review', SCRIPT_APPROVED: 'script_approved',
  RENDER_QUEUED: 'render_queued', RENDERING: 'rendering', RENDER_FAILED: 'render_failed',
  ASSET_REVIEW: 'asset_review', ASSET_APPROVED: 'asset_approved', PUBLISHED: 'published',
});
const RECUT_TASK_TYPES = Object.freeze({ GENERATE: 'generate', APPLY_SELECTION: 'apply_selection', APPLY_SUGGESTIONS: 'apply_suggestions' });
const RECUT_TASK_STATUSES = Object.freeze({ QUEUED: 'queued', RUNNING: 'running', CANCEL_REQUESTED: 'cancel_requested', SUCCEEDED: 'succeeded', FAILED: 'failed', CANCELLED: 'cancelled' });
const RECUT_REASON_LABELS = Object.freeze(['結論或定義', '理由', '例子', '冷開場', '複習', '離題', '指畫面', '重複']);
const RECUT_EDIT_REASONS = Object.freeze(['漏了重點', '不必要', '接不起來', '剪接點不自然', '其他']);
const RECUT_THEMES = Object.freeze(['N2', 'N1', 'C', 'B', 'G']);
const RECUT_APPROVAL_TYPES = Object.freeze(['script', 'asset']);
const RECUT_TIMING_PHASES = Object.freeze(['script_review', 'asset_review', 'production_wait']);
const RECUT_ATTEMPT_STATUSES = Object.freeze(['running', 'succeeded', 'failed', 'discarded']);
const RECUT_ACTIVE_TASK_STATUSES = Object.freeze(['queued', 'running', 'cancel_requested']);
module.exports = { RECUT_STAGES, PRODUCTION_MODES, RECUT_STATES, RECUT_TASK_TYPES, RECUT_TASK_STATUSES,
  RECUT_REASON_LABELS, RECUT_EDIT_REASONS, RECUT_THEMES, RECUT_APPROVAL_TYPES, RECUT_TIMING_PHASES,
  RECUT_ATTEMPT_STATUSES, RECUT_ACTIVE_TASK_STATUSES };
