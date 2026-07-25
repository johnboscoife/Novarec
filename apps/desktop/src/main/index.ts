import { join } from 'node:path';
import { app, BrowserWindow, dialog, shell } from 'electron';
import { registerIpcHandlers } from './ipc.js';
import { installContentSecurityPolicy } from './security.js';
import { registerHotkeys, unregisterHotkeys } from './hotkeys.js';
import { installDisplayMediaHandler } from './capture/display-media.js';
import { setHostWindow, hideControls } from './overlays/controls-window.js';
import { hideWebcam } from './overlays/webcam-window.js';
import {
  isRecordingActive,
  setConfirmOnExit,
  setStorageLocation,
  shouldConfirmExit,
} from './app-state.js';
import { loadAppSettings, saveAppSettings } from './app-settings-store.js';

const isDev = !app.isPackaged;

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
  // reloading, instead of leaving a black window.
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('Renderer process gone:', details.reason);
    if (details.reason !== 'clean-exit' && !window.isDestroyed()) window.reload();
  });
  window.webContents.on('unresponsive', () => {
    if (!window.isDestroyed()) window.webContents.reload();
  });

  // External links open in the OS browser, never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
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
    installDisplayMediaHandler(); // modern getDisplayMedia screen capture
    registerIpcHandlers();
    registerHotkeys(); // system-wide, works even when NovaRec is unfocused
    void loadAppSettings().then((s) => {
      setConfirmOnExit(s.confirmOnExit); // seed exit guard
      setStorageLocation(s.storageLocation); // seed the recordings vault location
    });
    setHostWindow(createMainWindow());

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
});

app.on('will-quit', () => {
  unregisterHotkeys();
  closeOverlays();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
