import { afterEach, describe, expect, it } from 'vitest';
import { networkInterfaces } from 'node:os';
import { request } from 'node:https';
import {
  startPhoneSession,
  stopPhoneSession,
  setPhoneAnswer,
  addDesktopCandidate,
  phoneSessionActive,
  type PhoneServerEvent,
} from './server.js';
import { pickLanAddress } from './pairing.js';

/**
 * Exercises the real HTTPS server. The pairing token is the ONLY thing standing
 * between this listening socket and anything else on the user's network, so it
 * is worth proving against the actual server rather than a mock.
 *
 * Skipped on a machine with no routable LAN address (CI containers), where a
 * pairing session cannot start by design.
 */
const hasLan = pickLanAddress(networkInterfaces()) !== null;

/** Fetch over TLS, accepting the session's self-signed certificate. */
function fetchInsecure(
  url: string,
  options: { method?: string; body?: string } = {},
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = request(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: options.method ?? 'GET',
        rejectUnauthorized: false, // self-signed by design; this is the test client
        headers: options.body ? { 'content-type': 'application/json' } : {},
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

describe.skipIf(!hasLan)('phone pairing server', () => {
  const events: PhoneServerEvent[] = [];

  afterEach(async () => {
    events.length = 0;
    await stopPhoneSession();
  });

  async function startSession(): Promise<{ url: string; base: string; token: string }> {
    const info = await startPhoneSession((e) => events.push(e));
    const url = new URL(info.url);
    return {
      url: info.url,
      base: `https://${url.host}`,
      token: url.searchParams.get('t') ?? '',
    };
  }

  it('serves the phone page only to a request carrying the pairing token', async () => {
    const { url, base } = await startSession();

    const authorized = await fetchInsecure(url);
    expect(authorized.status).toBe(200);
    expect(authorized.body).toContain('NovaRec camera');

    // The whole security model: no token, no access — and no information.
    const anonymous = await fetchInsecure(`${base}/`);
    expect(anonymous.status).toBe(403);
    expect(anonymous.body).not.toContain('NovaRec camera');
  });

  it('rejects a wrong token on every endpoint, not just the page', async () => {
    const { base } = await startSession();
    for (const path of ['/', '/api/answer', '/api/offer', '/api/ice', '/api/bye']) {
      const res = await fetchInsecure(`${base}${path}?t=not-the-token`);
      expect(res.status).toBe(403);
    }
  });

  it('forwards a phone offer to the desktop and returns the answer on poll', async () => {
    const { base, token } = await startSession();

    const posted = await fetchInsecure(`${base}/api/offer?t=${token}`, {
      method: 'POST',
      body: JSON.stringify({ sdp: 'v=0 fake-offer', type: 'offer' }),
    });
    expect(posted.status).toBe(200);
    expect(events).toContainEqual({ type: 'offer', sdp: 'v=0 fake-offer' });

    // The desktop answers; the phone collects it on its next poll.
    setPhoneAnswer('v=0 fake-answer');
    addDesktopCandidate({ candidate: 'candidate:1 udp' });

    const polled = await fetchInsecure(`${base}/api/answer?t=${token}`);
    const payload = JSON.parse(polled.body) as {
      answer: { sdp: string; type: string } | null;
      candidates: unknown[];
    };
    expect(payload.answer).toEqual({ sdp: 'v=0 fake-answer', type: 'answer' });
    expect(payload.candidates).toHaveLength(1);

    // Candidates are drained, so the phone never re-applies the same one.
    const again = await fetchInsecure(`${base}/api/answer?t=${token}`);
    expect((JSON.parse(again.body) as { candidates: unknown[] }).candidates).toHaveLength(0);
  });

  // A repeat offer is a RECONNECT — the phone reloaded the page, flipped its
  // camera, or recovered a dropped link. Refusing it stranded the phone on
  // "expired" with no way back short of restarting pairing on the desktop.
  it('accepts a reconnect from the phone and re-notifies the desktop', async () => {
    const { base, token } = await startSession();
    const first = await fetchInsecure(`${base}/api/offer?t=${token}`, {
      method: 'POST',
      body: JSON.stringify({ sdp: 'v=0 first', type: 'offer' }),
    });
    expect(first.status).toBe(200);

    const second = await fetchInsecure(`${base}/api/offer?t=${token}`, {
      method: 'POST',
      body: JSON.stringify({ sdp: 'v=0 second', type: 'offer' }),
    });
    expect(second.status).toBe(200);
    expect(events.filter((e) => e.type === 'offer')).toEqual([
      { type: 'offer', sdp: 'v=0 first' },
      { type: 'offer', sdp: 'v=0 second' },
    ]);
  });

  it('drops the previous answer and candidates when the phone reconnects', async () => {
    const { base, token } = await startSession();
    await fetchInsecure(`${base}/api/offer?t=${token}`, {
      method: 'POST',
      body: JSON.stringify({ sdp: 'v=0 first', type: 'offer' }),
    });
    setPhoneAnswer('v=0 stale-answer');
    addDesktopCandidate({ candidate: 'candidate:stale' });

    // Reconnecting must not hand the phone the previous connection's state —
    // applying it would break the new peer connection.
    await fetchInsecure(`${base}/api/offer?t=${token}`, {
      method: 'POST',
      body: JSON.stringify({ sdp: 'v=0 second', type: 'offer' }),
    });

    const polled = await fetchInsecure(`${base}/api/answer?t=${token}`);
    const payload = JSON.parse(polled.body) as { answer: unknown; candidates: unknown[] };
    expect(payload.answer).toBeNull();
    expect(payload.candidates).toHaveLength(0);
  });

  it('rejects a malformed offer', async () => {
    const { base, token } = await startSession();
    const res = await fetchInsecure(`${base}/api/offer?t=${token}`, {
      method: 'POST',
      body: JSON.stringify({ nope: true }),
    });
    expect(res.status).toBe(400);
    expect(events).toHaveLength(0);
  });

  it('404s an unknown path even with a valid token — there is no file routing', async () => {
    const { base, token } = await startSession();
    for (const path of ['/etc/passwd', '/../package.json', '/api/unknown']) {
      const res = await fetchInsecure(`${base}${encodeURI(path)}?t=${token}`);
      expect(res.status).toBe(404);
    }
  });

  it('stops listening when the session is stopped', async () => {
    const { url, base } = await startSession();
    expect(phoneSessionActive()).toBe(true);
    await stopPhoneSession();
    expect(phoneSessionActive()).toBe(false);
    await expect(fetchInsecure(url)).rejects.toThrow();
    await expect(fetchInsecure(`${base}/`)).rejects.toThrow();
  });

  it('replaces an existing session when a new one starts (no orphan listener)', async () => {
    const first = await startSession();
    const second = await startSession();
    expect(second.token).not.toBe(first.token);
    // The first session's socket is gone, so its URL no longer answers.
    await expect(fetchInsecure(first.url)).rejects.toThrow();
    expect((await fetchInsecure(second.url)).status).toBe(200);
  });
});
