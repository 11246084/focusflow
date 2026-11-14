// 「學生提問」卡片的說明文字：後端有提供來源分布時顯示網頁與 LINE 各幾次，舊版後端沒有就維持原文字。
export function describeQueriesSub(queriesBySource) {
  const { web, line } = queriesBySource || {};
  if (Number.isFinite(web) && Number.isFinite(line)) return `網頁 ${web}・LINE ${line}`;
  return '累計提問次數';
}
