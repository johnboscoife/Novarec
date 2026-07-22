import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { buildAccessToken, grantForRole } from './livekit-token.js';

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('LiveKit access token', () => {
  const options = {
    apiKey: 'devkey',
    apiSecret: 'secretsecretsecret',
    identity: 'user-1',
    name: 'Ada',
    ttlSeconds: 600,
    grant: grantForRole('standup', 'host'),
  };

  it('encodes the expected claims with a bounded TTL', () => {
    const now = 1_000_000;
    const token = buildAccessToken(options, now);
    const [, payloadSegment] = token.split('.');
    const payload = decodeSegment(payloadSegment ?? '');

    expect(payload['iss']).toBe('devkey');
    expect(payload['sub']).toBe('user-1');
    expect(payload['nbf']).toBe(now);
    expect(payload['exp']).toBe(now + 600);
    expect(payload['name']).toBe('Ada');
    expect(payload['video']).toMatchObject({ room: 'standup', roomJoin: true, canPublish: true });
  });

  it('produces a valid HS256 signature over header.payload', () => {
    const token = buildAccessToken(options, 42);
    const [header, payload, signature] = token.split('.');
    const expected = createHmac('sha256', options.apiSecret)
      .update(`${header}.${payload}`)
      .digest('base64url');
    expect(signature).toBe(expected);
  });

  it('omits the name claim when no display name is given', () => {
    const { name: _name, ...withoutName } = options;
    const token = buildAccessToken(withoutName, 0);
    const payload = decodeSegment(token.split('.')[1] ?? '');
    expect(payload['name']).toBeUndefined();
  });
});
