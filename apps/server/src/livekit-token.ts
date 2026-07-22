import { createHmac } from 'node:crypto';

// Local to keep the server free of the source-only @novarec/shared at runtime.
export type RoomRole = 'host' | 'participant';

/**
 * LiveKit room access tokens are standard HS256 JWTs signed with the API
 * secret. We sign them with Node crypto (no SDK, no network), and take `now`
 * as a parameter so the builder is pure and unit-tested.
 */
export interface VideoGrant {
  room: string;
  roomJoin: boolean;
  canPublish: boolean;
  canSubscribe: boolean;
  canPublishData: boolean;
}

export interface AccessTokenOptions {
  apiKey: string;
  apiSecret: string;
  identity: string;
  name?: string;
  ttlSeconds: number;
  grant: VideoGrant;
}

function base64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

export function grantForRole(room: string, _role: RoomRole): VideoGrant {
  // Publish/subscribe for everyone; host-only actions are enforced server-side
  // by LiveKit, not by the token.
  return { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true };
}

export function buildAccessToken(options: AccessTokenOptions, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload: Record<string, unknown> = {
    iss: options.apiKey,
    sub: options.identity,
    nbf: nowSeconds,
    exp: nowSeconds + options.ttlSeconds,
    video: options.grant,
  };
  if (options.name) payload['name'] = options.name;

  const body = base64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const signature = createHmac('sha256', options.apiSecret)
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${signature}`;
}
