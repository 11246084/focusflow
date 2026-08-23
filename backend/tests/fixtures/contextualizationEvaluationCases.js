module.exports = [
  { category: 'pronoun_resolution', description: '自然語言代名詞', history: [{ role: 'user', content: '什麼是自然語言？' }], currentQuestion: '那它跟程式語言有什麼差？', expectedRequiresContext: true, mustContain: ['自然語言', '程式語言'], mustNotContain: [] },
  { category: 'pronoun_resolution', description: 'CNN 缺點', history: [{ role: 'user', content: '什麼是 CNN？' }], currentQuestion: '它有哪些缺點？', expectedRequiresContext: true, mustContain: ['CNN', '缺點'], mustNotContain: [] },
  { category: 'pronoun_resolution', description: 'Transformer 應用', history: [{ role: 'user', content: '老師如何介紹 Transformer？' }], currentQuestion: '那它有哪些應用？', expectedRequiresContext: true, mustContain: ['Transformer', '應用'], mustNotContain: [] },
  { category: 'pronoun_resolution', description: '資料庫優點', history: [{ role: 'user', content: '何謂關聯式資料庫？' }], currentQuestion: '它的優點是什麼？', expectedRequiresContext: true, mustContain: ['關聯式資料庫', '優點'], mustNotContain: [] },
  { category: 'pronoun_resolution', description: 'API 安全性', history: [{ role: 'user', content: '什麼是 REST API？' }], currentQuestion: '那它安全嗎？', expectedRequiresContext: true, mustContain: ['REST API', '安全'], mustNotContain: [] },

  { category: 'ellipsis', description: '第二個特點', history: [{ role: 'user', content: '老師介紹了監督式學習的三個特點。' }], currentQuestion: '那第二個呢？', expectedRequiresContext: true, mustContain: ['監督式學習', '第二個'], mustNotContain: ['準確率高'] },
  { category: 'ellipsis', description: '下一個步驟', history: [{ role: 'user', content: '課程中提到模型訓練的四個步驟。' }], currentQuestion: '那第三個呢？', expectedRequiresContext: true, mustContain: ['模型訓練', '第三個'], mustNotContain: [] },
  { category: 'ellipsis', description: '另一項缺點', history: [{ role: 'user', content: '老師介紹了雲端運算的缺點。' }], currentQuestion: '還有呢？', expectedRequiresContext: true, mustContain: ['雲端運算', '還有'], mustNotContain: [] },
  { category: 'ellipsis', description: '前述方法', history: [{ role: 'user', content: '課程介紹資料正規化。' }], currentQuestion: '上述方法何時使用？', expectedRequiresContext: true, mustContain: ['資料正規化', '何時'], mustNotContain: [] },
  { category: 'ellipsis', description: '其中一項', history: [{ role: 'user', content: '老師提到三種排序演算法。' }], currentQuestion: '其中最快的是哪一種？', expectedRequiresContext: true, mustContain: ['排序演算法', '最快'], mustNotContain: [] },

  { category: 'reasoning_follow_up', description: 'Overfitting 原因', history: [{ role: 'user', content: '什麼是 Overfitting？' }], currentQuestion: '為什麼會這樣？', expectedRequiresContext: true, mustContain: ['Overfitting', '為什麼'], mustNotContain: [] },
  { category: 'reasoning_follow_up', description: '梯度消失原因', history: [{ role: 'user', content: '什麼是梯度消失？' }], currentQuestion: '為何如此？', expectedRequiresContext: true, mustContain: ['梯度消失', '為何'], mustNotContain: [] },
  { category: 'reasoning_follow_up', description: '延遲後果', history: [{ role: 'user', content: '老師提到網路延遲。' }], currentQuestion: '所以會造成什麼影響？', expectedRequiresContext: true, mustContain: ['網路延遲', '影響'], mustNotContain: [] },
  { category: 'reasoning_follow_up', description: '偏差改善', history: [{ role: 'user', content: '什麼是資料偏差？' }], currentQuestion: '那要怎麼改善？', expectedRequiresContext: true, mustContain: ['資料偏差', '改善'], mustNotContain: [] },
  { category: 'reasoning_follow_up', description: '快取必要性', history: [{ role: 'user', content: '老師介紹了快取。' }], currentQuestion: '為什麼需要它？', expectedRequiresContext: true, mustContain: ['快取', '為什麼'], mustNotContain: [] },

  { category: 'comparison_follow_up', description: 'CNN RNN 三輪比較', history: [{ role: 'user', content: '什麼是 CNN？' }, { role: 'assistant', content: '回答' }, { role: 'user', content: '那 RNN 呢？' }, { role: 'assistant', content: '回答' }], currentQuestion: '這兩個差在哪？', expectedRequiresContext: true, mustContain: ['CNN', 'RNN'], mustNotContain: [] },
  { category: 'comparison_follow_up', description: 'SQL NoSQL 比較', history: [{ role: 'user', content: '什麼是 SQL？' }], currentQuestion: '跟 NoSQL 有什麼差？', expectedRequiresContext: true, mustContain: ['SQL', 'NoSQL'], mustNotContain: [] },
  { category: 'comparison_follow_up', description: 'TCP UDP 比較', history: [{ role: 'user', content: '什麼是 TCP？' }], currentQuestion: '那 UDP 呢？', expectedRequiresContext: true, mustContain: ['TCP', 'UDP'], mustNotContain: [] },
  { category: 'comparison_follow_up', description: '分類回歸比較', history: [{ role: 'user', content: '老師解釋分類問題。' }], currentQuestion: '與回歸問題有何不同？', expectedRequiresContext: true, mustContain: ['分類問題', '回歸問題'], mustNotContain: [] },
  { category: 'comparison_follow_up', description: 'BFS DFS 比較', history: [{ role: 'user', content: '什麼是 BFS？' }, { role: 'user', content: '那 DFS 呢？' }], currentQuestion: '兩者的差異是什麼？', expectedRequiresContext: true, mustContain: ['BFS', 'DFS'], mustNotContain: [] },

  { category: 'topic_change', description: 'CNN 轉 MongoDB', history: [{ role: 'user', content: '什麼是 CNN？' }, { role: 'user', content: '它的缺點呢？' }], currentQuestion: '老師有介紹 MongoDB 嗎？', expectedRequiresContext: false, mustContain: ['MongoDB'], mustNotContain: ['CNN'] },
  { category: 'topic_change', description: 'API 轉 Docker', history: [{ role: 'user', content: '什麼是 REST API？' }], currentQuestion: '課程如何介紹 Docker？', expectedRequiresContext: false, mustContain: ['Docker'], mustNotContain: ['REST API'] },
  { category: 'topic_change', description: 'RNN 轉 JWT', history: [{ role: 'user', content: '什麼是 RNN？' }], currentQuestion: '老師有提到 JWT 嗎？', expectedRequiresContext: false, mustContain: ['JWT'], mustNotContain: ['RNN'] },
  { category: 'topic_change', description: '排序轉資料庫', history: [{ role: 'user', content: '什麼是快速排序？' }], currentQuestion: '關聯式資料庫有哪些特性？', expectedRequiresContext: false, mustContain: ['關聯式資料庫'], mustNotContain: ['快速排序'] },
  { category: 'topic_change', description: '雲端轉前端', history: [{ role: 'user', content: '老師介紹雲端運算。' }], currentQuestion: 'React 的 component 是什麼？', expectedRequiresContext: false, mustContain: ['React'], mustNotContain: ['雲端運算'] },

  { category: 'independent_question', description: 'Transformer 獨立題', history: [{ role: 'user', content: '什麼是 CNN？' }], currentQuestion: '老師怎麼解釋 Transformer？', expectedRequiresContext: false, mustContain: ['Transformer'], mustNotContain: ['CNN'] },
  { category: 'independent_question', description: 'MongoDB 獨立題', history: [{ role: 'user', content: '何謂機器學習？' }], currentQuestion: '什麼是 MongoDB？', expectedRequiresContext: false, mustContain: ['MongoDB'], mustNotContain: ['機器學習'] },
  { category: 'independent_question', description: 'HTTPS 獨立題', history: [{ role: 'user', content: '什麼是 HTTP？' }], currentQuestion: '課程中 HTTPS 的定義是什麼？', expectedRequiresContext: false, mustContain: ['HTTPS'], mustNotContain: [] },
  { category: 'independent_question', description: '無前文獨立題', history: [], currentQuestion: '老師如何介紹向量資料庫？', expectedRequiresContext: false, mustContain: ['向量資料庫'], mustNotContain: [] },
  { category: 'independent_question', description: '完整比較題', history: [{ role: 'user', content: '什麼是 CNN？' }], currentQuestion: 'Transformer 和 RNN 有什麼差異？', expectedRequiresContext: false, mustContain: ['Transformer', 'RNN'], mustNotContain: ['CNN'] },
];
