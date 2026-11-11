'use strict';
// Self-authored offline teaching example. No captured frame, OCR, API, or model output.
const params = {
  language: 'python',
  lines: [
    { text: 'value =', originalText: 'value =', source: '畫面原樣', intentionalError: true },
    { text: 'print(value)', originalText: 'print(value)', source: '畫面原樣' },
  ],
  requiredVariables: ['value'], highlightLines: [1], boxes: [{ line: 1, text: 'value' }],
  errorMessage: 'SyntaxError: invalid syntax',
};
module.exports = { params };
