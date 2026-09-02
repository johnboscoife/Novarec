import { app } from 'electron';

/**
 * Auto-update wiring for packaged builds. Deliberately defensive: it activates
 * only when a real update feed is configured (a `publish` provider in
 * electron-builder.yml, which makes electron-builder emit `app-update.yml` into
 * resources) — otherwise every path here no-ops instead of throwing, so a build
 * without release hosting can't crash or spam failed network calls on launch.
 *
 * To ENABLE auto-updates: add a `publish` block to electron-builder.yml (GitHub
 * releases or a generic server) and ensure `electron-updater` is packaged, then
 * rebuild. No code change here is needed — this runs the check automatically.
 */
export function initAutoUpdate(): void {
  if (!app.isPackaged) return; // dev/tests have no packaged update feed

  void (async () => {
    try {
      // Dynamic import so a build that doesn't package electron-updater simply
      // skips updates rather than failing at startup.
      const updater = await import('electron-updater');
      // electron-updater is CommonJS. Bundled into the CJS main output, the
      // import namespace exposes the module under `.default` rather than as
      // named exports, so reading `updater.autoUpdater` gave undefined — and
      // the resulting TypeError was swallowed by the catch below as "updates
      // unavailable". Auto-update therefore never ran in ANY packaged build,
      // silently. Accept either shape.
      const autoUpdater =
        updater.autoUpdater ??
        (updater as unknown as { default?: { autoUpdater?: typeof updater.autoUpdater } }).default
          ?.autoUpdater;
      if (!autoUpdater) {
        console.info('Auto-update unavailable: electron-updater exposed no autoUpdater.');
        return;
      }
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('error', (err: Error) => {
        console.error('Auto-update error:', err.message);
      });
      autoUpdater.on('update-available', (info: { version: string }) => {
        console.info(`Update available: ${info.version} — downloading in the background.`);
      });
      autoUpdater.on('update-downloaded', () => {
        console.info('Update downloaded; it will install on the next quit.');
      });
      await autoUpdater.checkForUpdatesAndNotify();
    } catch (error) {
      // No feed configured (app-update.yml absent), module not packaged, or the
      // machine is offline — all non-fatal. Updates are simply unavailable.
      console.info(
        'Auto-update unavailable:',
        error instanceof Error ? error.message : String(error),
      );
    }
  })();
}
