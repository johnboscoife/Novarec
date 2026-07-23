import { app } from 'electron';
import ffmpegStatic from 'ffmpeg-static';

/**
 * Resolve the FFmpeg binary used for export. Priority:
 * 1. `NOVAREC_FFMPEG` env override (dev / custom builds),
 * 2. the bundled static binary — unpacked from the asar in packaged builds,
 * 3. `ffmpeg` on PATH as a last resort.
 */
export function ffmpegBinaryPath(): string {
  const override = process.env['NOVAREC_FFMPEG'];
  if (override) return override;

  if (ffmpegStatic) {
    return app.isPackaged ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : ffmpegStatic;
  }
  return 'ffmpeg';
}
