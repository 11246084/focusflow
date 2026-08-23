// Ground truth dataset pending manual annotation.
// expectedRelevantChunkIds must remain empty until a reviewer verifies the course evidence.
module.exports = [
  {
    originalQuestion: '那它的缺點呢？',
    standaloneQuestion: '課程中 CNN 的缺點是什麼？',
    expectedRelevantChunkIds: [],
    originalTopK: [],
    rewrittenTopK: [],
  },
  {
    originalQuestion: '這兩個差在哪？',
    standaloneQuestion: '課程中 CNN 與 RNN 的差異是什麼？',
    expectedRelevantChunkIds: [],
    originalTopK: [],
    rewrittenTopK: [],
  },
];
