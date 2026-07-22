import { describe, it, expect } from 'vitest';
import { buildIngestUrl, type StreamTarget } from './streaming.js';

const target = (over: Partial<StreamTarget>): StreamTarget => ({
  id: 't',
  label: 'YouTube',
  protocol: 'rtmps',
  url: 'rtmps://a.rtmp.youtube.com/live2',
  ...over,
});

describe('buildIngestUrl', () => {
  it('appends the stream key to an RTMP base, normalizing slashes', () => {
    expect(
      buildIngestUrl(target({ url: 'rtmps://a.rtmp.youtube.com/live2/', streamKey: 'abcd-1234' })),
    ).toBe('rtmps://a.rtmp.youtube.com/live2/abcd-1234');
  });

  it('returns the base URL when no key is set', () => {
    expect(buildIngestUrl(target({ streamKey: undefined }))).toBe(
      'rtmps://a.rtmp.youtube.com/live2',
    );
  });

  it('leaves SRT URLs untouched', () => {
    const srt = target({
      protocol: 'srt',
      url: 'srt://host:9000?streamid=x',
      streamKey: 'ignored',
    });
    expect(buildIngestUrl(srt)).toBe('srt://host:9000?streamid=x');
  });
});
