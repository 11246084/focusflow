const { selectedIds } = require('./recutReviewSelection.service');
const { changedPaths } = require('./recutReviewScope.service');
function summarizeChanges(before, after, source) {
  const oldIds = selectedIds(before.selection, source), newIds = selectedIds(after.selection, source); const summary = [];
  for (const s of source.sentences) if (oldIds.has(s.id) !== newIds.has(s.id)) summary.push(`${newIds.has(s.id) ? '加回' : '移除'}：${s.text}`);
  if (before.selection.openingSentenceId !== after.selection.openingSentenceId) summary.push(after.selection.openingSentenceId ? '調整片頭重點句' : '移除片頭重點句');
  if (!summary.length && JSON.stringify(before.selection.ranges) !== JSON.stringify(after.selection.ranges)) summary.push('調整原話剪接範圍');
  const paths = changedPaths({ plan: before.plan, theme: before.theme }, { plan: after.plan, theme: after.theme });
  if (paths.some((p) => p === '/theme')) summary.push('調整畫面主題');
  if (paths.some((p) => p.startsWith('/plan/') && !p.startsWith('/plan/clips') && !p.startsWith('/plan/source'))) summary.push('更新圖卡、字幕或呈現內容');
  return summary.length ? summary : ['講述與呈現內容沒有變更'];
}
module.exports = { summarizeChanges };
