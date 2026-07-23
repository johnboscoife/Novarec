import { join } from 'node:path';
import { app, BrowserWindow, shell } from 'electron';
import { registerIpcHandlers } from './ipc.js';
import { installContentSecurityPolicy } from './security.js';
import { registerHotkeys, unregisterHotkeys } from './hotkeys.js';

const isDev = !app.isPackaged;

function createMainWindow(): void {
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
}

app
  .whenReady()
  .then(() => {
    installContentSecurityPolicy(isDev);
    registerIpcHandlers();
    registerHotkeys(); // system-wide, works even when NovaRec is unfocused
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  })
  .catch((error: unknown) => {
    console.error('Failed to start NovaRec main process:', error);
    app.quit();
  });

app.on('child-process-gone', (_event, details) => {
  console.error(`Child process gone: ${details.type} (${details.reason})`);
});

app.on('will-quit', () => unregisterHotkeys());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
