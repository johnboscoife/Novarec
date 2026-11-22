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
  /** Host only: manage participants and the room itself. */
  roomAdmin?: boolean;
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

export function grantForRole(room: string, role: RoomRole): VideoGrant {
  // LiveKit enforces exactly what the token grants, so host-only powers
  // (removing or muting participants, ending the room) must be IN the token.
  // Everyone may publish and subscribe; only the host administers the room.
  return {
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    ...(role === 'host' ? { roomAdmin: true } : {}),
  };
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
