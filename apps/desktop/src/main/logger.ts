import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';

/**
 * A plain-text error log, so a failure the user saw for a moment ("recording
 * reported an error") can still be read afterwards. Captures main-process
 * warnings/errors, failed IPC calls, and warnings/errors logged by any window.
 *
 * Location: `app.getPath('logs')/novarec.log` — on macOS
 * ~/Library/Logs/<app>/, on Windows %APPDATA%\<app>\logs\. Rotated at 1 MB,
 * keeping one previous file. Logging must never break the app, so every
 * failure in here is swallowed.
 */
const MAX_BYTES = 1024 * 1024;

let file: string | null = null;

export function logFilePath(): string {
  if (!file) {
    const dir = app.getPath('logs');
    mkdirSync(dir, { recursive: true });
    file = join(dir, 'novarec.log');
  }
  return file;
}

export function writeLog(level: 'info' | 'warn' | 'error', message: string): void {
  try {
    const path = logFilePath();
    try {
      if (statSync(path).size > MAX_BYTES) renameSync(path, `${path}.old`);
    } catch {
      // no log yet
    }
    appendFileSync(path, `${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`);
  } catch {
    // never let logging take the app down
  }
}

function describe(args: unknown[]): string {
  return args
    .map((a) =>
      a instanceof Error ? (a.stack ?? a.message) : typeof a === 'string' ? a : safeJson(a),
    )
    .join(' ');
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Mirror console warnings/errors and every window's warnings/errors into the log. */
export function installLogging(): void {
  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);
  console.error = (...args: unknown[]) => {
    writeLog('error', describe(args));
    originalError(...args);
  };
  console.warn = (...args: unknown[]) => {
    writeLog('warn', describe(args));
    originalWarn(...args);
  };
  process.on('unhandledRejection', (reason) => {
    writeLog('error', `Unhandled rejection: ${describe([reason])}`);
  });

  app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', (details) => {
      if (details.level !== 'warning' && details.level !== 'error') return;
      writeLog(
        details.level === 'error' ? 'error' : 'warn',
        `[window] ${details.message} (${details.sourceId}:${details.lineNumber})`,
      );
    });
  });

  writeLog('info', `NovaRec ${app.getVersion()} started on ${process.platform} ${process.arch}`);
}
