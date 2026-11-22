import { join } from 'node:path';
import { app, BrowserWindow, dialog, session, shell } from 'electron';
import { registerIpcHandlers } from './ipc.js';
import { installContentSecurityPolicy } from './security.js';
import { registerHotkeys, unregisterHotkeys } from './hotkeys.js';
import { installDisplayMediaHandler } from './capture/display-media.js';
import { setHostWindow, hideControls } from './overlays/controls-window.js';
import { hideWebcam } from './overlays/webcam-window.js';
import {
  isRecordingActive,
  setConfirmOnExit,
  setPreviousStorageLocations,
  setStorageLocation,
  shouldConfirmExit,
} from './app-state.js';
import { loadAppSettings, saveAppSettings } from './app-settings-store.js';
import { initAutoUpdate } from './auto-update.js';
import { stopPhoneSession } from './phone/server.js';
import { installLogging } from './logger.js';

const isDev = !app.isPackaged;

// End-to-end tests run the app against a throwaway profile so they can never
// read or write a developer's real recordings and settings. Must be set before
// anything resolves `userData`; ignored by installed builds.
const userDataOverride = process.env['NOVAREC_USER_DATA_DIR'];
if (isDev && userDataOverride) app.setPath('userData', userDataOverride);

// After the profile is settled, before anything can fail.
installLogging();

// Set once app.quit() has begun (menu quit, app.close() in tests, OS shutdown),
// so the window 'close' handler doesn't re-prompt on a programmatic quit.
let isQuitting = false;

/** Kill the floating overlays (and their camera streams) on the way out. */
function closeOverlays(): void {
  hideWebcam();
  hideControls();
}

async function persistNoConfirmOnExit(): Promise<void> {
  const settings = await loadAppSettings();
  await saveAppSettings({ ...settings, confirmOnExit: false });
  setConfirmOnExit(false);
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Keep capture running at full speed even if the window loses focus.
      backgroundThrottling: false,
      // Security posture is correct from commit one, not retrofitted.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  window.on('ready-to-show', () => window.show());

  // Lock the top frame to the app: a navigation to attacker-controlled content
  // (a rendered link, a location.href, an HTTP redirect) would otherwise hand
  // that page the entire contextBridge IPC surface. The SPA never navigates, so
  // anything trying to is untrusted — cancel it, and send real web links to the
  // OS browser like window.open already does.
  const sameOrigin = (a: string, b: string): boolean => {
    try {
      return new URL(a).origin === new URL(b).origin;
    } catch {
      return a === b;
    }
  };
  const guardNavigation = (event: Electron.Event, targetUrl: string): void => {
    if (!sameOrigin(targetUrl, window.webContents.getURL())) {
      event.preventDefault();
      if (/^https?:\/\//i.test(targetUrl)) void shell.openExternal(targetUrl);
    }
  };
  window.webContents.on('will-navigate', guardNavigation);
  window.webContents.on('will-redirect', guardNavigation);

  // Exit-intent confirmation. Skipped for programmatic quits (tests, OS
  // shutdown) so nothing hangs waiting on a dialog. Always tears down the
  // floating overlays so the webcam preview can't outlive the app.
  let allowClose = false;
  window.on('close', (event) => {
    if (allowClose || isQuitting) {
      closeOverlays();
      return;
    }
    const recording = isRecordingActive();
    if (!recording && !shouldConfirmExit()) {
      closeOverlays();
      return;
    }
    event.preventDefault();
    void dialog
      .showMessageBox(window, {
        type: recording ? 'warning' : 'question',
        buttons: ['Cancel', 'Quit'],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
        title: 'Quit NovaRec?',
        message: recording ? 'A recording is in progress. Quit anyway?' : 'Quit NovaRec?',
        detail: recording
          ? 'Your captured footage is already saved and can be recovered, but quitting ends the recording.'
          : 'Are you sure you want to quit NovaRec?',
        ...(recording ? {} : { checkboxLabel: "Don't ask me again", checkboxChecked: false }),
      })
      .then((result) => {
        if (result.response !== 1) return; // Cancel
        if (result.checkboxChecked) void persistNoConfirmOnExit();
        allowClose = true;
        closeOverlays();
        window.close();
      });
  });

  // Recover from a renderer/GPU crash (e.g. during heavy screen capture) by
  // reloading — but a deterministic startup crash (bad GPU driver) would loop
  // forever, pinning the CPU. Cap the reloads in a rolling window and, past the
  // cap, show a recovery dialog instead of reloading again.
  let crashTimes: number[] = [];
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process gone:', details.reason);
    if (details.reason === 'clean-exit' || window.isDestroyed()) return;
    const now = Date.now();
    crashTimes = crashTimes.filter((t) => now - t < 60_000);
    crashTimes.push(now);
    if (crashTimes.length > 3) {
      void dialog
        .showMessageBox(window, {
          type: 'error',
          buttons: ['Quit', 'Try again'],
          defaultId: 0,
          noLink: true,
          title: 'NovaRec keeps crashing',
          message: 'NovaRec’s display crashed repeatedly.',
          detail:
            'This is often a graphics-driver issue. Try updating your GPU driver, or relaunch to try again.',
        })
        .then((r) => {
          crashTimes = [];
          if (r.response === 1 && !window.isDestroyed()) window.reload();
          else app.quit();
        });
      return;
    }
    window.reload();
  });
  window.webContents.on('unresponsive', () => {
    // Never kill a live recording on a transient main-thread hang (a heavy
    // synchronous op) — the reload would destroy the in-flight recorder.
    if (isRecordingActive() || window.isDestroyed()) return;
    window.webContents.reload();
  });

  // External links open in the OS browser, never inside the app — and only
  // http(s), like every other path to openExternal: a `file:`, `smb:` or custom
  // protocol URL handed to the OS can launch programs or leak credentials.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  const rendererUrl = process.env['ELECTRON_RENDERER_URL'];
  if (isDev && rendererUrl) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'));
  }
  return window;
}

app
  .whenReady()
  .then(() => {
    installContentSecurityPolicy(isDev);
    // NovaRec only needs camera/mic (getUserMedia) and screen capture (handled
    // separately by the display-media handler). Electron's default auto-approves
    // every permission — lock it down so a navigated/compromised page can't grab
    // geolocation, notifications, etc.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === 'media');
    });
    installDisplayMediaHandler(); // modern getDisplayMedia screen capture
    registerIpcHandlers();
    registerHotkeys(); // system-wide, works even when NovaRec is unfocused
    void loadAppSettings().then((s) => {
      setConfirmOnExit(s.confirmOnExit); // seed exit guard
      setStorageLocation(s.storageLocation); // seed the recordings vault location
      setPreviousStorageLocations(s.previousStorageLocations); // and the older ones
    });
    setHostWindow(createMainWindow());
    initAutoUpdate(); // checks for updates in packaged builds with a feed configured

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) setHostWindow(createMainWindow());
    });
  })
  .catch((error: unknown) => {
    console.error('Failed to start NovaRec main process:', error);
    app.quit();
  });

app.on('child-process-gone', (_event, details) => {
  console.error(`Child process gone: ${details.type} (${details.reason})`);
});

app.on('before-quit', () => {
  isQuitting = true; // don't re-prompt when quitting programmatically
  closeOverlays();
  void stopPhoneSession();
});

app.on('will-quit', () => {
  unregisterHotkeys();
  closeOverlays();
  // Never leave a LAN listening socket behind after the app is gone.
  void stopPhoneSession();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
