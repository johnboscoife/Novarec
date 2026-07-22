/**
 * @novarec/encoder — the append-only segment writer, manifest event log, and
 * crash recovery that make "never lose a recording" true. The WebCodecs/FFmpeg
 * frame-encoding abstraction layers on top of this durable core.
 */
export const ENCODER_PACKAGE = '@novarec/encoder' as const;

export * from './manifest.js';
export * from './disk.js';
export * from './segment-writer.js';
export * from './recovery.js';
export * from './ffmpeg-command.js';
export * from './export-queue.js';
export * from './adaptive-bitrate.js';
