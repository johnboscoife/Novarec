import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, isAuthorized } from './app.js';
import { loadConfig, type ServerConfig } from './config.js';

const SECRET = 's'.repeat(40);
const config: ServerConfig = {
  livekitApiKey: 'key',
  livekitApiSecret: 'livekit-secret',
  livekitUrl: 'wss://example.livekit.cloud',
  serverSecret: SECRET,
  port: 8787,
};

const apps: FastifyInstance[] = [];
function app(): FastifyInstance {
  const instance = buildApp(config, { logger: false, now: () => 1_000_000_000 });
  apps.push(instance);
  return instance;
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
});

function videoGrant(token: string): Record<string, unknown> {
  const payload = JSON.parse(
    Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as { video: Record<string, unknown> };
  return payload.video;
}

const issue = (body: unknown, headers: Record<string, string> = {}, room = 'standup') =>
  app().inject({
    method: 'POST',
    url: `/rooms/${room}/token`,
    headers: { authorization: `Bearer ${SECRET}`, ...headers },
    payload: body as Record<string, unknown>,
  });

describe('token route', () => {
  it('refuses a request without the shared secret', async () => {
    const res = await issue({ identity: 'ada', role: 'host' }, { authorization: '' });
    expect(res.statusCode).toBe(401);
    const wrong = await issue({ identity: 'ada', role: 'host' }, { authorization: 'Bearer nope' });
    expect(wrong.statusCode).toBe(401);
  });

  it('answers malformed input with 400, not 500', async () => {
    expect((await issue({ identity: '', role: 'host' })).statusCode).toBe(400);
    expect((await issue({ identity: 'ada', role: 'owner' })).statusCode).toBe(400);
    expect((await issue({ identity: 'x'.repeat(129), role: 'host' })).statusCode).toBe(400);
    expect((await issue({ identity: 'ada', role: 'host' }, {}, 'bad%20room')).statusCode).toBe(400);
  });

  it('gives only the host room-admin powers', async () => {
    const host = await issue({ identity: 'ada', role: 'host' });
    const guest = await issue({ identity: 'bob', role: 'participant' });
    expect(host.statusCode).toBe(200);
    expect(videoGrant(host.json<{ token: string }>().token)['roomAdmin']).toBe(true);
    expect(videoGrant(guest.json<{ token: string }>().token)['roomAdmin']).toBeUndefined();
    expect(guest.json<{ url: string }>().url).toBe(config.livekitUrl);
  });
});

describe('isAuthorized', () => {
  it('needs the exact bearer secret', () => {
    expect(isAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isAuthorized(SECRET, SECRET)).toBe(false);
    expect(isAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isAuthorized(undefined, SECRET)).toBe(false);
  });
});

describe('loadConfig', () => {
  const env = {
    LIVEKIT_API_KEY: 'key',
    LIVEKIT_API_SECRET: 'secret',
    NOVAREC_SERVER_SECRET: SECRET,
  };

  it('refuses to start without credentials instead of using dev defaults', () => {
    expect(() => loadConfig({})).toThrow(/LIVEKIT_API_KEY, LIVEKIT_API_SECRET/);
    expect(() => loadConfig({ ...env, NOVAREC_SERVER_SECRET: 'short' })).toThrow(/at least 32/);
    expect(() => loadConfig({ ...env, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('reads a complete environment', () => {
    expect(loadConfig({ ...env, PORT: '9000' })).toMatchObject({ port: 9000, livekitUrl: null });
  });
});
