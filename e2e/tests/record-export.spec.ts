import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, _electron as electron } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const desktopMain = join(here, '..', '..', 'apps', 'desktop', 'out', 'main', 'index.js');
const ffmpegPath = createRequire(import.meta.url)('ffmpeg-static') as string;

/** The slice of the app's preload API this test uses. */
interface NovaRecWindow {
  novarec: {
    getAppSettings(): Promise<Record<string, unknown>>;
    saveAppSettings(settings: Record<string, unknown>): Promise<unknown>;
  };
}

/**
 * The whole Record pipeline on a real machine: capture → durable segments →
 * stop → finished MP4. Uses Chromium's fake microphone so it needs no device
 * and no OS permission prompt, and a throwaway profile and export folder so it
 * never touches a developer's own recordings.
 *
 * Requires the desktop app to be built first (`electron-vite build`).
 */
test('records the microphone and finishes a playable MP4', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'novarec-e2e-profile-'));
  const exportDir = await mkdtemp(join(tmpdir(), 'novarec-e2e-export-'));
  const env = { ...process.env, NOVAREC_USER_DATA_DIR: profile };
  delete env['ELECTRON_RUN_AS_NODE'];

  const app = await electron.launch({
    args: [desktopMain, '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    env,
  });
  try {
    const window = await app.firstWindow();
    await window.waitForFunction(() => 'novarec' in globalThis);
    await window.evaluate(async (folder) => {
      const { novarec } = globalThis as unknown as NovaRecWindow;
      const settings = await novarec.getAppSettings();
      await novarec.saveAppSettings({ ...settings, exportFolder: folder });
    }, exportDir);
    // Pick up the saved settings.
    await window.reload();
    // A fresh profile opens on the first-run welcome; go through it as a new user would.
    await window.getByRole('button', { name: 'Start recording' }).click();

    const mic = window.getByRole('switch', { name: 'Microphone', exact: true });
    await mic.click();
    await expect(mic).toHaveAttribute('aria-checked', 'true');
    // No screen picked: Record asks what to capture instead of silently
    // recording sound alone.
    await window.getByRole('button', { name: 'Record', exact: true }).click();
    const prompt = window.getByRole('dialog', { name: 'What do you want to record?' });
    await expect(prompt).toBeVisible();
    await expect(prompt.getByRole('tab', { name: 'Entire screen' })).toBeVisible();
    await expect(prompt.getByRole('tab', { name: 'A window' })).toBeVisible();
    await expect(prompt.getByRole('tab', { name: 'An area' })).toBeVisible();
    await prompt.getByRole('button', { name: 'Record audio only' }).click();
    await expect(prompt).toBeHidden();
    const stop = window.getByRole('button', { name: 'Stop', exact: true });
    // A 3-second countdown precedes the take.
    await expect(stop).toBeVisible({ timeout: 15_000 });
    // The floating controller must have no native tooltips: those are OS
    // windows outside its content protection, and they showed up in videos.
    const isControls = (w: { url(): string }): boolean => w.url().includes('overlay=controls');
    await expect.poll(() => app.windows().some(isControls), { timeout: 10_000 }).toBe(true);
    const controls = app.windows().find(isControls);
    if (!controls) throw new Error('floating controls did not open');
    await expect(controls.getByRole('button', { name: 'Stop' })).toBeVisible();
    expect(await controls.locator('[title]').count()).toBe(0);

    await window.waitForTimeout(3_000);
    await stop.click();

    await expect(window.getByText('Recording saved')).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(async () => (await readdir(exportDir)).filter((f) => f.endsWith('.mp4')), {
        timeout: 30_000,
      })
      .toHaveLength(1);

    const [file] = (await readdir(exportDir)).filter((f) => f.endsWith('.mp4'));
    const output = join(exportDir, file ?? '');
    expect((await stat(output)).size).toBeGreaterThan(10_000);

    // FFmpeg must be able to read it back, with an audio stream about as
    // long as the take.
    const probe = spawnSync(ffmpegPath, ['-hide_banner', '-i', output], { encoding: 'utf8' });
    expect(probe.stderr).toMatch(/Audio: aac/);
    const duration = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(probe.stderr);
    const seconds = duration
      ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
      : 0;
    expect(seconds).toBeGreaterThan(2);
    expect(seconds).toBeLessThan(15);
  } finally {
    await app.close();
    await rm(profile, { recursive: true, force: true });
    await rm(exportDir, { recursive: true, force: true });
  }
});
