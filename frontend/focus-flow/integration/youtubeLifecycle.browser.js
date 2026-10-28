/* global Buffer */
async (page) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const origin = 'http://127.0.0.1:5193';
  const entry = origin + '/integration/youtube-lifecycle-ui.html?view=';
  const videoId = '6f1000000000000000000001'; const courseId = '6f3000000000000000000001';
  const artifacts = 'D:/AI-workspace/04_Workbench/youtube-f3-f4-20261027';
  const checks = []; const unexpected = []; const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  let restored = false; let queued = false; let failRetry = true; let retryCalls = 0; let releaseRetry;
  let listEmpty = false; let statusError = false; let previewError = false; let settingsError = false; let patchCalls = 0;
  const switches = ['upload','recovery','cleanup'].map(key => ({ key, envAllowed: true, runtimeEnabled: false, effective: false, reason: 'runtime_disabled' }));
  const items = [
    { id: videoId, kind: 'video', title: '影片原片', courseTitle: 'F4 測試課程', sizeBytes: 1024, eligibleAt: '2026-10-29T00:00:00.000Z', reason: 'max_age' },
    { id: 'short-1', kind: 'short_asset', title: '短片成品', courseTitle: 'F4 測試課程', sizeBytes: 2048, eligibleAt: '2026-10-30T00:00:00.000Z', reason: 'low_space' },
  ];
  const video = () => ({ id: videoId, _id: videoId, courseId, title: 'F3 補回測試影片', course: 'F3 測試課程', teacher: '測試教師',
    sourceAvailable: restored, metadataOnly: false, status: queued ? 'queued' : 'completed', processing: { status: queued ? 'queued' : 'completed' },
    youtubeVideoId: 'f3Backup001', youtubeUpload: { status: 'uploaded', localCleanupAt: restored ? null : '2026-10-01T00:00:00.000Z' } });
  const preview = () => ({ count: listEmpty ? 0 : 2, totalBytes: listEmpty ? 0 : 3072, items: listEmpty ? [] : items });
  const settings = () => ({ switches, history: [], runtime: { recoveryIntervalMs: 300000, cleanupMinAgeDays: 14, cleanupMaxAgeDays: 180, freeSpaceGb: 5, cleanupMinFreeGb: 2 } });
  const fulfill = (route, data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ success: status < 400, data,
    ...(status >= 400 ? { message: '本機測試：暫時無法完成，請重試。', error: { code: 'TEST_FAILURE' } } : {}) }) });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith('/api/v1/')) return route.continue();
    const endpoint = url.pathname.slice('/api/v1'.length); const method = route.request().method();
    if (endpoint === '/courses') return fulfill(route, { courses: [{ _id: courseId, title: 'F3 測試課程', status: 'published', teacherId: '6f2000000000000000000001' }] });
    if (endpoint === `/courses/${courseId}/videos`) return fulfill(route, { videos: [video()] });
    if (endpoint === '/admin/videos') return fulfill(route, { videos: [video()] });
    if (endpoint === `/videos/${videoId}/source/restore`) { restored = true; return fulfill(route, { video: video() }); }
    if (endpoint === `/videos/${videoId}/processing/retry`) {
      retryCalls++;
      if (failRetry) { failRetry = false; return fulfill(route, {}, 503); }
      await new Promise(resolve => { releaseRetry = resolve; }); queued = true;
      return fulfill(route, { id: videoId, processing: { status: 'queued' } });
    }
    if (endpoint === '/admin/stats') return fulfill(route, { totalUsers: 2, totalVideos: 1 });
    if (endpoint === '/admin/system-status') return fulfill(route, { checkedAt: '2026-10-27T00:00:00.000Z', services: [{ key: 'youtube', name: 'YouTube 自動上傳', status: 'not_enabled', detail: '執行期設定已關閉' }],
      youtubeLifecycle: { switches: statusError ? null : switches, quarantineCount: 0, upcomingCleanupCount: listEmpty ? 0 : 2,
        upcomingCleanupBytes: listEmpty ? 0 : 3072, upcomingCleanupItems: statusError ? null : preview().items, error: statusError ? 'unknown' : null } });
    if (endpoint === '/admin/youtube-lifecycle/settings') {
      if (settingsError) return fulfill(route, {}, 503);
      if (method === 'PATCH') { patchCalls++; const body = route.request().postDataJSON(); const sw = switches.find(s => s.key === body.key); Object.assign(sw, { runtimeEnabled: body.enabled, effective: body.enabled, reason: body.enabled ? null : 'runtime_disabled' }); }
      return fulfill(route, settings());
    }
    if (endpoint === '/admin/youtube-lifecycle/cleanup-preview') return fulfill(route, preview(), previewError && url.searchParams.get('scope') === 'enable' ? 503 : 200);
    if (endpoint === '/admin/youtube-quarantine') return fulfill(route, { items: [], searchable: false });
    unexpected.push(`${method} ${endpoint}`); return fulfill(route, {}, 404);
  });
  for (const view of ['teacher','videos']) {
    restored = false; queued = false; failRetry = true; retryCalls = 0; releaseRetry = null;
    await page.goto(entry + view);
    if (view === 'teacher') await page.getByText('F3 測試課程', { exact: true }).click();
    const action = page.getByRole('button', { name: '重新處理', exact: true });
    await action.waitFor(); if (!(await action.isDisabled())) throw new Error('Missing source must disable reprocess');
    await page.getByRole('button', { name: '補回原片', exact: true }).click();
    await page.getByLabel('原始影片檔').setInputFiles({ name: 'fixture.mp4', mimeType: 'video/mp4',
      buffer: Buffer.from('0000000866747970000000086d646174000000086d6f6f76', 'hex') });
    await page.getByRole('button', { name: '上傳並補回', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: '重新處理', exact: true }).click();
    const confirm = page.getByRole('button', { name: '確認重新處理', exact: true });
    await confirm.click(); await page.getByRole('dialog').getByRole('alert').waitFor();
    if (!(await page.getByRole('dialog').isVisible())) throw new Error('Failure must stay in dialog');
    await confirm.click(); await page.waitForFunction(() => document.querySelector('button[type="submit"]')?.disabled);
    if (retryCalls !== 2 || !(await page.getByRole('button', { name: '取消', exact: true }).isDisabled())) throw new Error('Busy state must prevent duplicate submissions');
    if (!releaseRetry) throw new Error('No pending retry request'); releaseRetry();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByText('已重新排入處理佇列。', { exact: true }).waitFor();
    await page.screenshot({ path: `${artifacts}/${view}-reprocessed.png`, fullPage: true }); checks.push(`${view}: restore -> failed retry stays -> busy -> queued`);
  }
  await page.goto(entry + 'overview');
  await page.getByRole('table', { name: '7 天內到期清理清單' }).waitFor();
  if ((await page.getByRole('table').getByRole('row').count()) !== 3) throw new Error('Overview must list both source kinds');
  await page.getByText('自動上傳：未啟用', { exact: true }).waitFor();
  await page.screenshot({ path: artifacts + '/overview-list.png', fullPage: true }); checks.push('overview: runtime off and two-item list');
  listEmpty = true; await page.reload(); await page.getByText('7 天內沒有到期的原片。').waitFor(); checks.push('overview: empty state');
  statusError = true; await page.reload(); await page.getByRole('alert').filter({ hasText: '狀態未知' }).waitFor();
  if (await page.locator('[data-overview-switch]').count()) throw new Error('Unknown must not show stale switches'); checks.push('overview: unknown state');
  statusError = false; listEmpty = false; previewError = true;
  await page.goto(entry + 'lifecycle');
  const cleanupToggle = page.locator('[data-switch="cleanup"]').getByRole('button', { name: '啟用', exact: true });
  await cleanupToggle.click(); await page.getByRole('alert').waitFor();
  if (patchCalls || await page.getByRole('dialog').count()) throw new Error('Preview failure must not enable cleanup'); checks.push('cleanup: preview failure blocks enable');
  previewError = false; await cleanupToggle.click(); await page.getByRole('dialog').waitFor();
  await page.screenshot({ path: artifacts + '/cleanup-enable-confirm.png', fullPage: true });
  await page.getByRole('button', { name: '確認啟用', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  if (patchCalls !== 1) throw new Error('Cleanup should enable once after confirmation'); checks.push('cleanup: confirm sends one update');
  settingsError = true; await page.getByRole('button', { name: '重新整理', exact: true }).click();
  await page.getByRole('alert').waitFor();
  if (await page.locator('[data-switch]').count()) throw new Error('Failed refresh must clear stale enabled switches'); checks.push('management: failed refresh clears enabled state');
  if (unexpected.length || pageErrors.length) throw new Error(JSON.stringify({ unexpected, pageErrors }));
  return { passed: checks.length, checks, unexpectedRequests: unexpected, pageErrors };
}
