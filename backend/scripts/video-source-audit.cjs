/* Linux VM, read-only: no application/model/service imports. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { createRequire } = require('node:module');

function stat(file) {
  try { const s = fs.statSync(file); return { exists: true, realPath: fs.realpathSync(file), device: s.dev, inode: s.ino, bytes: s.size, mtime: s.mtime.toISOString(), isFile: s.isFile() }; }
  catch (e) { return { exists: e.code === 'ENOENT' ? false : null, error: e.code }; }
}
function command(name, args) {
  try { return { ok: true, output: cp.execFileSync(name, args, { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] }).trim() }; }
  catch (e) { return { ok: false, error: e.code || 'COMMAND_FAILED' }; }
}
async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('node backend/scripts/video-source-audit.cjs [--pid PID] [--video-id OBJECTID] [--limit 1000] [--log-file PATH]'); return;
  }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--pid', '--video-id', '--limit', '--log-file'].includes(args[i]) || !args[i + 1]) throw new Error('ARGUMENTS');
    options[args[i]] = args[i + 1];
  }
  if (!options['--pid']) {
    const pm2Pid = command('pm2', ['pid', 'focusflow-backend']);
    const detected = pm2Pid.ok ? pm2Pid.output.split(/\s+/).filter(x => /^\d+$/.test(x) && x !== '0').at(-1) : null;
    if (detected) options['--pid'] = detected;
  }
  if (process.platform !== 'linux' || !/^\d+$/.test(options['--pid'] || '')) throw new Error('LINUX_PID_REQUIRED');
  const v = process.versions.node.split('.').map(Number);
  if (!((v[0] === 22 && (v[1] > 23 || v[1] === 23 && v[2] >= 4)) || (v[0] === 24 && (v[1] > 22 || v[1] === 22 && v[2] >= 1)))) throw new Error('UNSUPPORTED_NODE');
  const limit = Number(options['--limit'] || 1000);
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000) throw new Error('LIMIT_1_TO_10000');
  const proc = `/proc/${options['--pid']}`;
  const before = fs.readFileSync(`${proc}/stat`, 'utf8');
  const cwd = fs.realpathSync(`${proc}/cwd`);
  const cmdline = fs.readFileSync(`${proc}/cmdline`, 'utf8').split('\0').filter(Boolean);
  const backend = fs.realpathSync(path.resolve(__dirname, '..'));
  const matchesCheckout = cwd === backend || cmdline.some(arg => {
    try { return fs.realpathSync(path.resolve(cwd, arg)).startsWith(`${backend}${path.sep}`); }
    catch { return arg.startsWith(`${backend}${path.sep}`); }
  });
  if (!matchesCheckout) throw new Error('PID_CWD_MUST_MATCH_THIS_BACKEND_CHECKOUT');
  const req = createRequire(path.join(backend, 'package.json'));
  const inherited = Object.fromEntries(fs.readFileSync(`${proc}/environ`, 'utf8').split('\0').filter(Boolean).map(x => { const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1)]; }));
  const envFile = path.join(backend, '.env');
  const diskEnv = fs.existsSync(envFile) ? req('dotenv').parse(fs.readFileSync(envFile)) : {};
  const env = { ...diskEnv, ...inherited };
  const keys = ['UPLOAD_DIR', 'YOUTUBE_UPLOAD_CLEANUP_ENABLED', 'YOUTUBE_UPLOAD_CLEANUP_INTERVAL_MS', 'YOUTUBE_UPLOAD_CLEANUP_MAX_AGE_DAYS', 'YOUTUBE_UPLOAD_CLEANUP_MIN_FREE_GB', 'YOUTUBE_UPLOAD_CLEANUP_MIN_AGE_DAYS'];
  const defaults = ['uploads', 'false', '3600000', '180', '10', '14'];
  const configuration = Object.fromEntries(keys.map((k, i) => [k, { value: env[k] || defaults[i], source: Object.hasOwn(inherited, k) ? 'process_initial_environment' : Object.hasOwn(diskEnv, k) ? 'current_dotenv_unverified_at_process_start' : 'checkout_default' }]));
  const uploadDir = path.resolve(backend, env.UPLOAD_DIR || 'uploads');
  const cwdUploadDir = cwd !== backend ? path.resolve(cwd, env.UPLOAD_DIR || 'uploads') : null;
  const report = { capturedAt: new Date().toISOString(), pid: Number(options['--pid']), backend, processCwd: cwd, processExecutable: fs.realpathSync(`${proc}/exe`), processStat: before, gitHead: command('git', ['-C', backend, 'rev-parse', 'HEAD']), configuration,
    limitations: ['proc environment excludes dotenv loaded after process start; current .env and checkout may differ from running code', 'filesystem and database are not a transactional snapshot', 'no YouTube API requests; remote state is database evidence only', 'no raw logs collected; inspect restricted logs separately'],
    dotenv: stat(envFile), storage: { path: uploadDir, stat: stat(uploadDir), ...(cwdUploadDir ? { cwdPath: cwdUploadDir, cwdStat: stat(cwdUploadDir) } : {}), mount: command('findmnt', ['-T', uploadDir, '-n', '-o', 'TARGET,SOURCE,FSTYPE']), disk: command('df', ['-Pk', uploadDir]) } };
  if (options['--log-file']) {
    const filename = path.resolve(options['--log-file']);
    let fd;
    try {
      fd = fs.openSync(filename, 'r');
      const s = fs.fstatSync(fd);
      if (!s.isFile()) throw new Error('NOT_REGULAR_FILE');
      const length = Math.min(s.size, 8 * 1024 * 1024);
      const buffer = Buffer.alloc(length);
      const read = fs.readSync(fd, buffer, 0, length, s.size - length);
      const lines = buffer.subarray(0, read).toString('utf8').split('\n').slice(s.size > length ? 1 : 0);
      report.log = { path: filename, bytesAtRead: s.size, tailBytesRead: read, truncated: s.size > length,
        matchingLineCounts: Object.fromEntries(['YouTube local cleanup failed', 'Local file removed', 'Local file deletion failed', 'ENOENT', 'cleanup_disabled'].map(term => [term, lines.filter(line => line.includes(term)).length])) };
    } catch { report.log = { ok: false, error: 'LOG_UNREADABLE_OR_NOT_REGULAR_FILE' }; process.exitCode = 2; }
    finally { if (fd !== undefined) fs.closeSync(fd); }
  }
  let client;
  try {
    const { MongoClient, ObjectId } = req('mongodb');
    if (!env.MONGODB_URI) throw new Error('MONGODB_URI_MISSING');
    client = new MongoClient(env.MONGODB_URI, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 10000, socketTimeoutMS: 15000, appName: 'focusflow-video-source-audit' });
    await client.connect();
    const db = client.db();
    const query = {};
    if (options['--video-id']) {
      if (!/^[a-f0-9]{24}$/i.test(options['--video-id'])) throw new Error('INVALID_VIDEO_ID');
      query._id = new ObjectId(options['--video-id']);
    }
    const setting = await db.collection('runtimesettings').findOne({ key: 'youtubeLifecycle.cleanup' }, { projection: { value: 1, updatedAt: 1, 'history.from': 1, 'history.to': 1, 'history.changedAt': 1 }, maxTimeMS: 10000 });
    report.cleanupSetting = setting;
    report.cleanupEffectiveReconstructed = String(env.YOUTUBE_UPLOAD_CLEANUP_ENABLED || 'false').toLowerCase() === 'true' && setting?.value === true;
    const projection = { filePath: 1, createdAt: 1, updatedAt: 1, deletedAt: 1, videoSource: 1, youtubeVideoId: 1, 'processing.status': 1 };
    for (const key of ['status', 'uploadedAt', 'readyAt', 'remoteState', 'localCleanupAt', 'localSourceRestoredAt', 'localSourceVersion', 'cleanupClaimedAt', 'cleanupIntent.id', 'cleanupIntent.phase', 'cleanupIntent.storageKey', 'cleanupIntent.file.localPath']) projection[`youtubeUpload.${key}`] = 1;
    const rows = await db.collection('videos').find(query, { projection, maxTimeMS: 10000 }).sort({ _id: 1 }).limit(limit + 1).toArray();
    report.truncated = rows.length > limit;
    report.videos = rows.slice(0, limit).map(v => {
      const resolved = v.filePath ? path.resolve(backend, v.filePath) : null;
      const local = resolved ? stat(resolved) : null;
      const cwdResolved = v.filePath && cwd !== backend ? path.resolve(cwd, v.filePath) : null;
      const cwdLocal = cwdResolved && cwdResolved !== resolved ? stat(cwdResolved) : null;
      return { ...v, resolvedPath: resolved, local, ...(cwdLocal ? { cwdResolvedPath: cwdResolved, cwdLocal } : {}), evidence: v.youtubeUpload?.localCleanupAt ? 'cleanup_metadata_present_requires_log_corroboration' : local?.exists === false ? (cwdLocal?.exists === true ? 'found_under_process_cwd' : 'path_missing_cause_unknown') : !resolved ? 'no_file_path_cause_unknown' : 'inspect_local_result' };
    });
  } catch (e) { report.database = { ok: false, error: ['MONGODB_URI_MISSING', 'INVALID_VIDEO_ID'].includes(e.message) ? e.message : 'DB_QUERY_FAILED_CHECK_CONNECTIVITY_AND_READ_PERMISSION' }; process.exitCode = 2; }
  finally { await client?.close(); }
  report.sameProcessAtEnd = fs.readFileSync(`${proc}/stat`, 'utf8').split(') ')[1]?.split(' ')[19] === before.split(') ')[1]?.split(' ')[19];
  console.log(JSON.stringify(report, null, 2));
}
main().catch(e => { console.error(JSON.stringify({ ok: false, error: /^[A-Z_0-9]+$/.test(e.message) ? e.message : 'AUDIT_FAILED_CHECK_PID_PATH_PERMISSIONS' })); process.exitCode = 1; });
