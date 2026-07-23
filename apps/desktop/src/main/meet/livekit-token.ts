import { createHmac } from 'node:crypto';

/**
 * LiveKit room access tokens are HS256 JWTs signed with the API secret. We mint
 * them locally in the main process (no SDK, no network) from the credentials the
 * user configured in Settings — the same scheme as @novarec/server, kept here so
 * the desktop app can host meetings without running the separate service.
 */
export type RoomRole = 'host' | 'participant';

interface VideoGrant {
  room: string;
  roomJoin: boolean;
  canPublish: boolean;
  canSubscribe: boolean;
  canPublishData: boolean;
}

interface AccessTokenOptions {
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

export function grantForRoom(room: string): VideoGrant {
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

  const signingInput = `${header}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac('sha256', options.apiSecret)
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${signature}`;
}
