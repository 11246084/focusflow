// 向量相似度共用工具。原本 faqCache.service.js 與 qa.service.js 各有一份
// 逐字相同的實作，抽出於此避免第三份複製（短影片腳本自動選題也需要）。
function computeCosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length === 0) {
    return null;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  if (!leftNorm || !rightNorm) {
    return null;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

module.exports = {
  computeCosineSimilarity,
};
