import { desktopCapturer, session } from 'electron';

/**
 * Modern screen capture path. The renderer selects a source in our UI, tells us
 * which one via `capture:setSource`, then calls `getDisplayMedia`; this handler
 * hands back that exact source (no OS picker). This replaces the deprecated
 * `getUserMedia({ chromeMediaSource: 'desktop' })` path, which was unreliable in
 * current Chromium (stalled frames / crashes).
 */
interface PendingSource {
  sourceId: string | null;
  audio: boolean;
}

let pending: PendingSource = { sourceId: null, audio: false };

export function setPendingCaptureSource(sourceId: string | null, audio: boolean): void {
  pending = { sourceId, audio };
}

export function installDisplayMediaHandler(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          const chosen =
            sources.find((s) => s.id === pending.sourceId) ??
            sources.find((s) => s.id.startsWith('screen:')) ??
            sources[0];
          if (!chosen) {
            callback({});
            return;
          }
          // 'loopback' captures system audio on Windows.
          callback(pending.audio ? { video: chosen, audio: 'loopback' } : { video: chosen });
        })
        .catch(() => callback({}));
    },
    { useSystemPicker: false },
  );
}
