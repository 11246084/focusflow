const { closeSync, writeSync } = require('fs');

const STT_OWNED_OPTIONAL_ENV_KEYS = ['GEMINI_API_KEY'];

function buildSttProcessEnvironment(parentEnvironment, overrides) {
  const childEnvironment = {
    ...parentEnvironment,
    ...overrides,
  };

  // An empty Backend value would mask the valid value loaded later from
  // STT_Whisper/.env because python-dotenv does not override existing keys.
  for (const key of STT_OWNED_OPTIONAL_ENV_KEYS) {
    if (!String(childEnvironment[key] || '').trim()) {
      delete childEnvironment[key];
    }
  }

  return childEnvironment;
}

function appendLifecycleLog(logFd, message) {
  try {
    writeSync(logFd, `\n${message}\n`);
  } catch {
    // The Pipeline log is best-effort after the child process has closed.
  }
}

function buildExitDescription(code, signal, spawnError) {
  if (spawnError) {
    return `spawn error: ${spawnError.message}`;
  }

  const codeLabel = code === null || code === undefined ? 'null' : String(code);
  const signalLabel = signal || 'none';
  return `exit code=${codeLabel} signal=${signalLabel}`;
}

function attachSttProcessLifecycle({
  sttProcess,
  logFd,
  videoId,
  onUnexpectedExit,
  successfulExitCodes = [0],
  onClose = null,
}) {
  let spawnError = null;

  sttProcess.on('error', (error) => {
    spawnError = error;
    appendLifecycleLog(
      logFd,
      `[spawn error] video=${videoId} ${error.stack || error.message}`,
    );
  });

  sttProcess.on('exit', (code, signal) => {
    appendLifecycleLog(
      logFd,
      `[pipeline exit] video=${videoId} code=${code ?? 'null'} signal=${signal || 'none'}`,
    );
  });

  sttProcess.once('close', async (code, signal) => {
    const successfulExit = !spawnError && successfulExitCodes.includes(code) && !signal;
    const description = buildExitDescription(code, signal, spawnError);

    appendLifecycleLog(
      logFd,
      `[pipeline close] video=${videoId} ${description}`,
    );

    try {
      if (!successfulExit) {
        await onUnexpectedExit({
          errorMessage: `STT Pipeline terminated unexpectedly (${description}).`,
          errorCode: 'PIPELINE_PROCESS_EXITED',
        });
      }
    } catch (error) {
      appendLifecycleLog(
        logFd,
        `[pipeline status update failed] video=${videoId} ${error.stack || error.message}`,
      );
    } finally {
      if (onClose) {
        try {
          await onClose({ code, signal, successfulExit });
        } catch (error) {
          appendLifecycleLog(
            logFd,
            `[pipeline close callback failed] video=${videoId} ${error.stack || error.message}`,
          );
        }
      }
      try {
        closeSync(logFd);
      } catch {
        // Ignore an already-closed descriptor.
      }
    }
  });
}

module.exports = {
  attachSttProcessLifecycle,
  buildSttProcessEnvironment,
  buildExitDescription,
};
