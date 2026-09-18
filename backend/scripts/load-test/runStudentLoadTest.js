// 模擬 N 位學生同時登入並瀏覽課程，量測各 API 的回應時間與錯誤率。
// 只打唯讀 API（登入除外），不提問、不標記觀看、不寫入任何資料，不消耗 Gemini 額度。
//
// 用法（PowerShell，於 backend/ 下）：
//   $env:LOADTEST_EMAIL="student@focusflow.local"
//   $env:LOADTEST_PASSWORD="Student123!"
//   node scripts/load-test/runStudentLoadTest.js
//
// 帳號來源（二擇一）：
//   LOADTEST_EMAIL + LOADTEST_PASSWORD   所有虛擬學生共用同一個學生帳號
//   LOADTEST_ACCOUNTS_FILE               CSV，每行 email,password（可有標題列），虛擬學生依序輪用
//
// 選用環境變數：
//   LOADTEST_BASE_URL   預設 https://focusflow.ntub.edu.tw
//   LOADTEST_USERS      同時上線的虛擬學生數，預設 10
//   LOADTEST_ROUNDS     每位學生重複瀏覽幾輪，預設 3
//   LOADTEST_RAMP_MS    所有學生在幾毫秒內陸續上線，預設 0（同一瞬間登入，模擬上課開始）
//   LOADTEST_THINK_MS   每個頁面之間的停頓毫秒數，預設 500
//   LOADTEST_TIMEOUT_MS 單一請求逾時，預設 30000
//   LOADTEST_MAX_USERS  安全上限，預設 200；超過需自行調高

const fs = require('fs');

const BASE_URL = (process.env.LOADTEST_BASE_URL || 'https://focusflow.ntub.edu.tw').replace(/\/+$/, '');
const API = `${BASE_URL}/api/v1`;
const USERS = Number(process.env.LOADTEST_USERS || 10);
const ROUNDS = Number(process.env.LOADTEST_ROUNDS || 3);
const RAMP_MS = Number(process.env.LOADTEST_RAMP_MS || 0);
const THINK_MS = Number(process.env.LOADTEST_THINK_MS || 500);
const TIMEOUT_MS = Number(process.env.LOADTEST_TIMEOUT_MS || 30000);
const MAX_USERS = Number(process.env.LOADTEST_MAX_USERS || 200);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// endpoint 名稱 -> [{ ms, status, code }]
const samples = new Map();

function record(name, entry) {
  if (!samples.has(name)) samples.set(name, []);
  samples.get(name).push(entry);
}

function loadAccounts() {
  const file = process.env.LOADTEST_ACCOUNTS_FILE;
  if (file) {
    const accounts = fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.split(',').map((cell) => cell.trim()))
      .filter(([email, password]) => email && password && email.includes('@'))
      .map(([email, password]) => ({ email, password }));
    if (!accounts.length) throw new Error(`${file} 沒有可用的 email,password 資料列。`);
    return accounts;
  }

  const email = process.env.LOADTEST_EMAIL;
  const password = process.env.LOADTEST_PASSWORD;
  if (!email || !password) {
    throw new Error('請設定 LOADTEST_EMAIL 與 LOADTEST_PASSWORD，或設定 LOADTEST_ACCOUNTS_FILE。');
  }
  return [{ email, password }];
}

async function call(name, path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const startedAt = performance.now();
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    const ms = performance.now() - startedAt;
    record(name, { ms, status: res.status, code: res.ok ? null : (data.error?.code || `HTTP_${res.status}`) });
    return res.ok ? data : null;
  } catch (err) {
    const ms = performance.now() - startedAt;
    const code = err.name === 'TimeoutError' ? 'TIMEOUT' : `NETWORK_${err.cause?.code || err.name}`;
    record(name, { ms, status: 0, code });
    return null;
  }
}

async function runStudent(index, account) {
  if (RAMP_MS > 0) await sleep((RAMP_MS / USERS) * index);

  const login = await call('POST /auth/login', '/auth/login', {
    method: 'POST',
    body: { email: account.email, password: account.password, role: 'student' },
  });
  const token = login?.data?.token;
  if (!token) return;

  for (let round = 0; round < ROUNDS; round += 1) {
    // 依學生端頁面實際載入順序：Topbar、Dashboard、課程列表、課程內影片與對話、教學短片牆。
    await Promise.all([
      call('GET /auth/me', '/auth/me', { token }),
      call('GET /notifications', '/notifications', { token }),
      call('GET /stats/student', '/stats/student', { token }),
    ]);
    await sleep(THINK_MS);

    const courses = await call('GET /courses', '/courses', { token });
    const courseList = Array.isArray(courses?.data) ? courses.data : (courses?.data?.courses || []);
    const course = courseList[index % Math.max(courseList.length, 1)];
    if (course) {
      const courseId = encodeURIComponent(course._id || course.id);
      await Promise.all([
        call('GET /courses/:id/videos', `/courses/${courseId}/videos`, { token }),
        call('GET /conversations?courseId', `/conversations?courseId=${courseId}`, { token }),
      ]);
    }
    await sleep(THINK_MS);

    await call('GET /youtube/shorts', '/youtube/shorts', { token });
    await sleep(THINK_MS);
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const rank = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, rank)];
}

function printReport(elapsedMs) {
  const rows = [];
  let total = 0;
  let failed = 0;
  const errorCounts = new Map();

  for (const [name, entries] of samples) {
    const times = entries.map((e) => e.ms).sort((a, b) => a - b);
    const errors = entries.filter((e) => e.code);
    total += entries.length;
    failed += errors.length;
    for (const e of errors) {
      const key = `${name}  ${e.code}`;
      errorCounts.set(key, (errorCounts.get(key) || 0) + 1);
    }
    rows.push({
      endpoint: name,
      requests: entries.length,
      errors: errors.length,
      p50_ms: Math.round(percentile(times, 50)),
      p95_ms: Math.round(percentile(times, 95)),
      max_ms: Math.round(times[times.length - 1] || 0),
    });
  }

  console.log('\n=== 各 API 回應時間 ===');
  console.table(rows);

  console.log(`總請求數：${total}，失敗：${failed}（${total ? ((failed / total) * 100).toFixed(1) : 0}%）`);
  console.log(`總耗時：${(elapsedMs / 1000).toFixed(1)} 秒，平均 ${(total / (elapsedMs / 1000)).toFixed(1)} 請求/秒`);

  if (errorCounts.size) {
    console.log('\n=== 錯誤明細 ===');
    for (const [key, count] of errorCounts) console.log(`  ${count} 次  ${key}`);
  }
}

async function main() {
  if (!Number.isInteger(USERS) || USERS < 1) throw new Error('LOADTEST_USERS 必須是正整數。');
  if (USERS > MAX_USERS) {
    throw new Error(`LOADTEST_USERS=${USERS} 超過安全上限 ${MAX_USERS}；確定要跑請調高 LOADTEST_MAX_USERS。`);
  }

  const accounts = loadAccounts();
  console.log(`目標：${API}`);
  console.log(`虛擬學生：${USERS} 位（${accounts.length} 個帳號輪用），每位 ${ROUNDS} 輪，上線時間 ${RAMP_MS}ms 內`);

  // 先用第一個帳號單獨登入一次；帳密錯誤時只失敗這一次就停下，不會讓 N 位虛擬學生一起輸錯而觸發登入鎖定。
  const preflight = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: accounts[0].email, password: accounts[0].password, role: 'student' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!preflight.ok) {
    const data = await preflight.json().catch(() => ({}));
    console.log(`\n預先登入失敗（${accounts[0].email}）：HTTP ${preflight.status} ${data.error?.code || ''}`);
    console.log('請確認帳號存在、角色是學生、密碼正確；PowerShell 裡密碼請用單引號包住，避免 $ 被當成變數。');
    process.exitCode = 1;
    return;
  }

  const startedAt = performance.now();
  await Promise.all(
    Array.from({ length: USERS }, (_, index) => runStudent(index, accounts[index % accounts.length])),
  );
  printReport(performance.now() - startedAt);

  const loginErrors = (samples.get('POST /auth/login') || []).filter((e) => e.code).length;
  if (loginErrors === USERS) {
    console.log('\n所有登入都失敗，請先確認帳號密碼與 role=student 是否正確。');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
