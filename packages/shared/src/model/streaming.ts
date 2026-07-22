import { z } from 'zod';

/**
 * Streaming egress targets (RTMP/RTMPS/SRT). Presets cover the common
 * destinations; multi-destination simulcast is a list of these.
 */
export const StreamProtocolSchema = z.enum(['rtmp', 'rtmps', 'srt']);
export type StreamProtocol = z.infer<typeof StreamProtocolSchema>;

export const StreamTargetSchema = z.object({
  id: z.string(),
  label: z.string(),
  protocol: StreamProtocolSchema,
  url: z.string().min(1), // base ingest URL, no key
  streamKey: z.string().optional(),
});
export type StreamTarget = z.infer<typeof StreamTargetSchema>;

export interface StreamPreset {
  label: string;
  protocol: StreamProtocol;
  url: string;
}

export const STREAM_PRESETS: StreamPreset[] = [
  { label: 'YouTube', protocol: 'rtmps', url: 'rtmps://a.rtmp.youtube.com/live2' },
  { label: 'Twitch', protocol: 'rtmp', url: 'rtmp://live.twitch.tv/app' },
  { label: 'LinkedIn', protocol: 'rtmps', url: 'rtmps://1-a.rtmp.linkedin.com/live' },
  { label: 'Facebook', protocol: 'rtmps', url: 'rtmps://live-api-s.facebook.com:443/rtmp' },
];

/** Full ingest URL with the stream key appended (RTMP) — SRT carries keys itself. */
export function buildIngestUrl(target: StreamTarget): string {
  if (target.protocol === 'srt') return target.url;
  const base = target.url.replace(/\/+$/, '');
  return target.streamKey ? `${base}/${target.streamKey}` : base;
}
