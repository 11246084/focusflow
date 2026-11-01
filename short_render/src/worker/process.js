'use strict';
const { spawn } = require('node:child_process');
const { workerError } = require('./http');

function toolEnvironment(input = process.env) {
  // Tools need OS paths, not worker/API credentials or arbitrary application settings.
  const allowed = new Set(['path', 'systemroot', 'windir', 'comspec', 'pathext', 'temp', 'tmp', 'tmpdir',
    'userprofile', 'home', 'localappdata', 'appdata', 'programdata', 'lang', 'lc_all']);
  return Object.fromEntries(Object.entries(input).filter(([key]) => allowed.has(key.toLowerCase())));
}

// A worker owns its process tree. Cancellation must stop Chrome/encoder children
// before the job directory is removed or the next job is accepted.
function createCommandRunner({ spawnImpl = spawn, platform = process.platform, killGroup = process.kill } = {}) {
  return (binary, args, { cwd, env, signal } = {}) => new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const child = spawnImpl(binary, args, { cwd, env: env || toolEnvironment(), windowsHide: true, detached: platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', aborted = false, spawnFailed = false, terminating = Promise.resolve();
    const append = (previous, chunk) => (previous + chunk).slice(-4 * 1024 * 1024);
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.on('error', () => { spawnFailed = true; });
    const cancel = () => {
      if (aborted) return;
      aborted = true;
      if (!child.pid || child.exitCode !== null) return;
      if (platform === 'win32') {
        terminating = new Promise((done) => {
          // PID comes only from our own spawned child, never job/config text.
          const killer = spawnImpl('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
          killer.once('error', () => { child.kill(); done(); });
          killer.once('close', done);
        });
      } else {
        try { killGroup(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
    };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    child.once('close', async (code) => {
      await terminating;
      signal?.removeEventListener('abort', cancel);
      if (aborted) reject(signal.reason || workerError('RECUT_RENDER_CANCELLED'));
      else if (spawnFailed || code !== 0) reject(workerError('RECUT_RENDER_TRANSIENT'));
      else resolve({ stdout, stderr });
    });
  });
}
module.exports = { createCommandRunner, toolEnvironment };
