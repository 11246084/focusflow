// 給教師看的腳本狀態：由 script.status 加上同一份腳本的成品（listAssets 的
// sourceScriptId）推算，只在前端顯示，不新增後端狀態。
//
// group：action＝需要教師處理；waiting＝等系統或審核；done＝已結束。
// 清單把 waiting 與 done 合併成「等待中／已完成」。

export const DISPLAY_STATUS = {
  to_generate: { label: '待生成', group: 'action', next: '生成腳本' },
  to_film: { label: '待拍攝上傳', group: 'action', next: '複製腳本，拍完後上傳成品' },
  uploading: { label: '傳送中', group: 'waiting', next: '等待影片傳上 YouTube' },
  upload_failed: { label: '上傳失敗', group: 'action', next: '到成品上傳重試' },
  upload_needs_admin: { label: '上傳失敗', group: 'waiting', next: '等管理員確認後自動更新' },
  in_review: { label: '待審核', group: 'waiting', next: '到「短影片審核」看片審核' },
  // 審核已通過但影片還沒傳完：傳完後系統自動上架（publishApprovedShortAsset）。
  approved_waiting_upload: { label: '審核通過，等上架', group: 'waiting', next: '影片傳完後自動上架' },
  // 成品被退回、但腳本沒轉成 changes_requested（後端 applyAssetRejection 失敗時不擋審核）。
  asset_rejected: { label: '成品已退回', group: 'action', next: '到成品上傳重傳，或重新生成' },
  changes_requested: { label: '需修改', group: 'action', next: '重新生成，或重傳同一版' },
  published: { label: '已上架（學生可見）', group: 'done', next: '' },
  dismissed: { label: '已否決', group: 'done', next: '' },
};

// 同一份腳本的「目前這支」成品：優先取還沒進學生牆的那支（重拍會在它身上換代），
// 沒有才取已發布的。封存的不算。
export function findScriptAsset(scriptId, assets = []) {
  const own = assets.filter((asset) => asset.sourceScriptId === String(scriptId) && asset.status !== 'archived');
  return own.find((asset) => asset.status !== 'published') || own.find((asset) => asset.status === 'published') || null;
}

export function deriveDisplayStatus(script, assets = []) {
  const key = deriveDisplayStatusKey(script, assets);
  return { key, ...DISPLAY_STATUS[key] };
}

function deriveDisplayStatusKey(script, assets) {
  switch (script?.status) {
    case 'dismissed': return 'dismissed';
    case 'approved': return 'published';
    case 'changes_requested': return 'changes_requested';
    case 'evidence_ready': return 'to_generate';
    default: break;
  }

  const asset = findScriptAsset(script?._id, assets);
  if (!asset) return 'to_film';
  if (asset.status === 'published') return 'published';
  if (asset.upload?.status === 'failed') return asset.upload.retrySafe ? 'upload_failed' : 'upload_needs_admin';
  // upload.status 為 null：成品剛建立，排程上傳還沒寫入狀態，一樣是傳送中。
  if (asset.upload?.status !== 'uploaded') return 'uploading';
  if (asset.reviewStatus === 'rejected') return 'asset_rejected';
  if (asset.reviewStatus === 'approved') return 'approved_waiting_upload';
  return 'in_review';
}

// 成品詳情的三件事分開呈現：審核狀態、YouTube 傳送狀態、學生是否可見。
export function describeAssetState(asset) {
  if (!asset) return null;
  const review = { pending: '待審核', approved: '審核通過', rejected: '已退回' }[asset.reviewStatus] || '待審核';
  const youtube = asset.upload?.status === 'uploaded'
    ? `已傳上 YouTube${asset.privacyStatus ? `（${{ unlisted: '非公開', private: '私人', public: '公開' }[asset.privacyStatus] || asset.privacyStatus}）` : ''}`
    : asset.upload?.status === 'failed' ? '傳送失敗' : '傳送中';
  const studentVisible = asset.status === 'published';
  return { review, youtube, studentVisible, students: studentVisible ? '學生可見' : '學生看不到' };
}

function toSortedRows(scripts, assets) {
  return scripts
    .map((script) => ({ script, status: deriveDisplayStatus(script, assets) }))
    .sort((left, right) => String(right.script.updatedAt || right.script.createdAt || '')
      .localeCompare(String(left.script.updatedAt || left.script.createdAt || '')));
}

// 腳本頁的清單分組。同組內最近更新的在前，教師打開頁面先看到剛動過的腳本。
export function groupScripts(scripts = [], assets = []) {
  const rows = toSortedRows(scripts, assets);
  return {
    action: rows.filter((row) => row.status.group === 'action'),
    others: rows.filter((row) => row.status.group !== 'action'),
  };
}

// 成品上傳頁只列「影片還沒處理完」的腳本：
// 待上傳＝有腳本可以拍、還沒傳或要重傳；處理中＝已傳、等系統或審核。
// 待生成（還沒有腳本）、已上架、已否決不列；已上架的仍可從腳本頁開到這裡重傳。
const UPLOAD_GROUP = {
  to_film: 'toUpload',
  changes_requested: 'toUpload',
  asset_rejected: 'toUpload',
  uploading: 'processing',
  upload_failed: 'processing',
  upload_needs_admin: 'processing',
  in_review: 'processing',
  approved_waiting_upload: 'processing',
};

export function groupUploadScripts(scripts = [], assets = []) {
  const rows = toSortedRows(scripts, assets);
  return {
    toUpload: rows.filter((row) => UPLOAD_GROUP[row.status.key] === 'toUpload'),
    processing: rows.filter((row) => UPLOAD_GROUP[row.status.key] === 'processing'),
  };
}
