const DEFAULT_LOG_PREVIEW_LENGTH = 80;

function summarizeTextForLog(value, limit = DEFAULT_LOG_PREVIEW_LENGTH) {
  const text = String(value ?? '');
  return {
    length: text.length,
    preview: text.slice(0, limit),
  };
}

module.exports = {
  DEFAULT_LOG_PREVIEW_LENGTH,
  summarizeTextForLog,
};
