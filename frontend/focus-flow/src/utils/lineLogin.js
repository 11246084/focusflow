import { apiFetch } from '../api.js';

const LINE_AUTHORIZE_ORIGIN = 'https://access.line.me';

// 綁定完成後一律回到這一頁，不接受網址參數指定。
export const LINE_PAGE_PATH = '/app/line';

// 向後端開始連結並取得 LINE 授權網址。只接受 LINE 官方網域，回應異常時不導向其他網站。
export async function requestLineAuthorizeUrl({ courseId, replaceExisting = false, fetchImpl } = {}) {
  const result = await apiFetch('/line/login/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(courseId ? { courseId } : {}),
      ...(replaceExisting ? { replaceExisting: true } : {}),
    }),
    ...(fetchImpl ? { fetchImpl } : {}),
  });

  const authorizeUrl = result.data?.authorizeUrl;
  if (!authorizeUrl || new URL(authorizeUrl).origin !== LINE_AUTHORIZE_ORIGIN) {
    throw new Error('無法開始連結 LINE，請稍後再試。');
  }
  return authorizeUrl;
}

const LINE_AUTO_START_KEY = 'ff_line_auto_start';

// 未綁定的學生進 LINE 提問頁時直接前往授權，每個分頁只自動一次：
// 學生在 LINE 取消或按返回後回到這頁，要看到按鈕，不能又被帶走而卡在迴圈。
// 瀏覽器不給用 sessionStorage 時不自動，避免無法判斷是否跑過。
export function claimLineAutoStart(storage = globalThis.sessionStorage) {
  try {
    if (storage.getItem(LINE_AUTO_START_KEY)) return false;
    storage.setItem(LINE_AUTO_START_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

// 解析 LINE 導回網址：學生取消授權時帶 error，正常時帶 code 與 state。
export function readLineCallback(search) {
  const params = new URLSearchParams(search);
  if (params.get('error')) return { kind: 'cancelled' };

  const code = params.get('code');
  const state = params.get('state');
  return code && state ? { kind: 'authorized', code, state } : { kind: 'invalid' };
}

// state 只能用一次，開發模式的 StrictMode 會執行兩次 effect，同一個 state 共用同一個請求。
const pendingCompletions = new Map();

export function completeLineLogin({ code, state }, { fetchImpl } = {}) {
  if (!pendingCompletions.has(state)) {
    pendingCompletions.set(state, apiFetch('/line/login/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, state }),
      // 這頁沒有登入狀態可清；未登入要提示回原瀏覽器，不是導去登入頁。
      sessionFailure: false,
      ...(fetchImpl ? { fetchImpl } : {}),
    }).then((result) => result.data));
  }
  return pendingCompletions.get(state);
}

export function describeLineLoginSuccess(data = {}) {
  const courseNote = data.course ? `已切換到「${data.course.title}」，可以直接提問。` : '';
  const heading = data.alreadyBound ? '這個 LINE 已經連結過了' : data.replaced ? '已換成新的 LINE' : 'LINE 連結完成';

  if (data.friendship === 'friend') {
    return {
      heading,
      message: `${data.welcomeSent ? '聊天室已收到歡迎訊息，' : ''}現在可以到 LINE 提問。${courseNote}`,
      needsFriend: false,
    };
  }

  return {
    heading,
    message: data.friendship === 'not_friend'
      ? `帳號已連結，但還沒加入官方帳號，加入後才能在 LINE 提問。${courseNote}`
      : `帳號已連結，但無法確認是否已加入官方帳號；如果在 LINE 找不到聊天室，請先加入。${courseNote}`,
    needsFriend: true,
  };
}

const LOGIN_FAILURES = {
  UNAUTHORIZED: {
    heading: '請回到原本的瀏覽器',
    message: '這個瀏覽器沒有登入 FocusFlow，所以沒有連結 LINE。請回到原本的瀏覽器，重新按一次「連結 LINE」。',
  },
  INVALID_TOKEN: {
    heading: '請回到原本的瀏覽器',
    message: '登入已過期，所以沒有連結 LINE。請登入後重新連結。',
  },
  LINE_LOGIN_STATE_MISMATCH: {
    heading: '這個連結不是你發起的',
    message: '為了保護帳號，這次沒有連結 LINE。如果這是你要連結的，請回到 FocusFlow 自己按「連結 LINE」；別人傳給你的連結請不要開啟。',
  },
  LINE_LOGIN_STATE_INVALID: {
    heading: '這次連結已失效',
    message: '連結超過 10 分鐘或已經用過，請重新連結。',
    canRetry: true,
  },
  LINE_ACCOUNT_ALREADY_BOUND: {
    heading: '這個 LINE 已綁定其他帳號',
    message: '請先用那個 FocusFlow 帳號解除綁定，或改用另一個 LINE。',
  },
  LINE_REPLACE_CONFIRMATION_REQUIRED: {
    heading: '要取代目前的 LINE 嗎？',
    message: '你的帳號已綁定另一個 LINE。確定要換的話，舊的 LINE 將不能再用你的身分提問。',
    canReplace: true,
  },
  LINE_LOGIN_NOT_CONFIGURED: {
    heading: '暫時無法連結 LINE',
    message: '請回到 LINE 提問頁，用那裡顯示的方式綁定。',
  },
};

const LINE_LOGIN_RETRY = {
  heading: '連結沒有完成',
  message: 'LINE 帳號沒有變更，請重新連結。',
  canRetry: true,
};

export function describeLineLoginFailure(error) {
  return LOGIN_FAILURES[error?.code] || LINE_LOGIN_RETRY;
}

export const LINE_LOGIN_CANCELLED = {
  heading: '已取消連結',
  message: '你取消了 LINE 授權，帳號沒有變更。想連結時可以再試一次。',
  canRetry: true,
};

export const LINE_LOGIN_INVALID_CALLBACK = {
  heading: '找不到連結資料',
  message: '這個網址沒有連結資料，可能已經處理過了。請回到 LINE 提問頁查看目前狀態。',
};

const FRIEND_STATUS_TEXT = {
  friend: '已加入官方帳號',
  not_friend: '尚未加入官方帳號，加入後才能在 LINE 提問',
  unknown: '無法確認是否已加入官方帳號',
};

export function describeFriendStatus(status) {
  return FRIEND_STATUS_TEXT[status] || FRIEND_STATUS_TEXT.unknown;
}
