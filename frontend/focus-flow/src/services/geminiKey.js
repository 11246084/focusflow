import { apiFetch } from '../api.js';

// 金鑰只放在呼叫參數與元件 state；不寫入 localStorage／sessionStorage／網址，也不出現在錯誤訊息。
const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function fetchGeminiKeyStatus(fetcher = apiFetch) {
  return (await fetcher('/admin/gemini-key')).data;
}

export async function stepUpAdmin(password, fetcher = apiFetch) {
  await fetcher('/auth/step-up', { ...json({ password }), sessionFailure: false });
}

export async function testGeminiKey(apiKey, fetcher = apiFetch) {
  return (await fetcher('/admin/gemini-key/test', json({ apiKey }))).data;
}

export async function activateGeminiKey(apiKey, testId, fetcher = apiFetch) {
  return (await fetcher('/admin/gemini-key/activate', json({ apiKey, testId }))).data;
}

export const SOURCE_LABELS = {
  environment: '主機環境變數（尚未在此頁更換過）',
  rotated: '管理員在此頁更換的金鑰',
  none: '尚未設定',
};

export const PERSISTENCE_LABELS = {
  file: '保存在主機本機的私有檔案，重啟後仍有效',
  memory: '只保存在執行中的後端，重啟後會回到主機環境變數的金鑰',
};

export const STORAGE_ERROR_LABELS = {
  GEMINI_KEY_STORAGE_PATH_INVALID: '保存檔路徑不符規定（須為絕對路徑，且在程式目錄與上傳目錄之外）',
  GEMINI_KEY_STORAGE_PERMISSIONS_INVALID: '保存檔或其目錄權限過寬、擁有者不符或為連結',
  GEMINI_KEY_STORAGE_CORRUPT: '保存檔內容無法讀取',
  GEMINI_KEY_STORAGE_FAILED: '保存檔無法存取',
};

export function describeCheck(check) {
  if (check.check === 'embedding') return `向量 ${check.model}：通過（${check.dimensions} 維）`;
  return `文字生成 ${check.model}：通過`;
}

// 頁面在輸入改變時清掉測試結果，所以這裡只需確認測試仍在有效期限內。
// 後端仍會比對金鑰與 testId，這只是避免送出必定失敗的請求。
export function canActivate(testResult, now = Date.now()) {
  return Boolean(testResult?.testId) && Date.parse(testResult.expiresAt) > now;
}

// 需要重新輸入密碼的錯誤：顯示密碼欄，其他錯誤照常顯示訊息。
export function needsStepUp(error) {
  return error?.code === 'STEP_UP_REQUIRED';
}
