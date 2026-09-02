import { createServer, type Server } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import * as selfsigned from 'selfsigned';
import {
  buildPairingUrl,
  formatPairingCode,
  listLanAddresses,
  tokenMatches,
  type LanAddress,
} from './pairing.js';
import { mobilePageHtml } from './mobile-page.js';

/**
 * A short-lived local HTTPS server that lets a phone on the same Wi-Fi stream
 * its camera into NovaRec, with no third-party app.
 *
 * WHY HTTPS: `getUserMedia` only runs in a secure context, and `http://192.168…`
 * is not one. A self-signed certificate is therefore unavoidable, and the phone
 * will show a warning the user has to accept once per session.
 *
 * SECURITY POSTURE — this opens a listening socket on the user's LAN, so it is
 * deliberately constrained:
 *   - it runs ONLY while the user is actively pairing, and shuts itself down on
 *     an idle timeout, on disconnect, and on app quit;
 *   - every request must carry the pairing token from the QR code, compared
 *     without early exit; anything else gets 403 and no information;
 *   - it serves exactly one static page and five fixed signalling endpoints —
 *     there is no path routing to the filesystem, and no way to read anything
 *     off this machine;
 *   - a repeat offer is treated as a RECONNECT of the paired phone (reload,
 *     dropped link) and replaces the previous connection, because refusing it
 *     stranded the phone with no way back; the token remains the gate, so this
 *     grants nothing to a device that never scanned the code;
 *   - the certificate is generated fresh per session and never leaves memory.
 */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 256 * 1024;
const CERT_VALID_DAYS = 2;

export interface PhoneSessionInfo {
  url: string;
  code: string;
  host: string;
  port: number;
  /**
   * Every address the phone might reach this machine at, best first. Offered to
   * the user because only they know which network or cable the phone is on —
   * a tethered phone cannot reach the Wi-Fi address, and vice versa.
   */
  addresses: LanAddress[];
}

/** Signalling messages the server hands to the desktop renderer. */
export type PhoneServerEvent =
  | { type: 'offer'; sdp: string }
  | { type: 'ice'; candidate: unknown }
  | { type: 'disconnected' }
  | { type: 'expired' };

interface SessionState {
  token: string;
  server: Server;
  port: number;
  host: string;
  /** The phone's offer, once it arrives. One phone per session. */
  offerReceived: boolean;
  answer: { sdp: string; type: string } | null;
  /** Desktop ICE candidates waiting for the phone to poll them. */
  pendingForPhone: unknown[];
  idleTimer: NodeJS.Timeout;
  onEvent: (event: PhoneServerEvent) => void;
}

let session: SessionState | null = null;

interface SelfsignedResult {
  private: string;
  cert: string;
}

/**
 * `selfsigned`'s bundled types declare nothing exported, so the boundary is
 * typed here rather than silently `any`. The callback form is used deliberately:
 * RSA key generation in pure JS takes a second or two, and the synchronous form
 * would block the main process — freezing every window — while it runs.
 */
type GenerateFn = (
  attrs: { name: string; value: string }[],
  opts: Record<string, unknown>,
  done: (err: Error | undefined, result: SelfsignedResult) => void,
) => void;

function generateCertificate(host: string): Promise<{ key: string; cert: string }> {
  const generate = (selfsigned as unknown as { generate: GenerateFn }).generate;
  return new Promise((resolve, reject) => {
    generate(
      [{ name: 'commonName', value: host }],
      {
        days: CERT_VALID_DAYS,
        // Browsers reject RSA keys below 2048 bits outright, warning or not.
        keySize: 2048,
        algorithm: 'sha256',
        extensions: [
          { name: 'basicConstraints', cA: false },
          { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
          // Without serverAuth a browser refuses the cert even after the user
          // accepts the "not private" warning.
          { name: 'extKeyUsage', serverAuth: true },
          // Naming the IP as a SAN is what lets the phone accept this
          // certificate for this address once the user trusts it.
          {
            name: 'subjectAltName',
            altNames: [
              { type: 7, ip: host },
              { type: 2, value: 'localhost' },
            ],
          },
        ],
      },
      (err, pems) => {
        if (err) reject(err);
        else resolve({ key: pems.private, cert: pems.cert });
      },
    );
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      // A signalling payload is a few KB; anything larger is not our protocol.
      if (body.length > MAX_BODY_BYTES) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    'content-type': contentType,
    'cache-control': 'no-store',
    // This page is only ever opened directly on the phone; never let another
    // origin frame it or sniff its type.
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
  });
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, JSON.stringify(value), 'application/json');
}

function touch(state: SessionState): void {
  state.idleTimer.refresh();
}

async function handleRequest(
  state: SessionState,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', `https://${state.host}`);
  // Single gate for every route, including the page itself.
  if (!tokenMatches(state.token, url.searchParams.get('t'))) {
    send(res, 403, 'Forbidden', 'text/plain');
    return;
  }
  touch(state);

  if (req.method === 'GET' && url.pathname === '/') {
    send(res, 200, mobilePageHtml(), 'text/html; charset=utf-8');
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/offer') {
    const parsed: unknown = JSON.parse(await readBody(req));
    const sdp = (parsed as { sdp?: unknown }).sdp;
    if (typeof sdp !== 'string') {
      sendJson(res, 400, { error: 'Malformed offer' });
      return;
    }
    // A REPEAT offer is a reconnect, not an intruder: the phone reloaded the
    // page, recovered from a dropped connection, or renegotiated. Refusing it
    // (as this used to) left the phone permanently stuck on "expired" with no
    // way back except restarting pairing on the desktop. Anyone reaching this
    // point already holds the one-time token, which is the actual gate.
    //
    // Stale answer and candidates belong to the previous connection and would
    // corrupt the new one, so drop them.
    state.answer = null;
    state.pendingForPhone = [];
    state.offerReceived = true;
    state.onEvent({ type: 'offer', sdp });
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/answer') {
    const candidates = state.pendingForPhone;
    state.pendingForPhone = [];
    sendJson(res, 200, { answer: state.answer, candidates });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/ice') {
    const parsed: unknown = JSON.parse(await readBody(req));
    const candidate = (parsed as { candidate?: unknown }).candidate;
    if (candidate) state.onEvent({ type: 'ice', candidate });
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/bye') {
    state.onEvent({ type: 'disconnected' });
    sendJson(res, 200, { ok: true });
    return;
  }

  send(res, 404, 'Not found', 'text/plain');
}

/**
 * Start a pairing session. Resolves with what the desktop should render as a QR
 * code, or throws when this machine has no LAN address a phone could reach.
 */
export async function startPhoneSession(
  onEvent: (event: PhoneServerEvent) => void,
  /** Bind the advertised URL to this address instead of the best guess. */
  preferredHost?: string,
): Promise<PhoneSessionInfo> {
  await stopPhoneSession();

  const addresses = listLanAddresses(networkInterfaces());
  // Honour an explicit choice only if it is still a real address on this
  // machine — a stale pick from a unplugged cable must not be advertised.
  const chosen =
    preferredHost && addresses.some((a) => a.address === preferredHost)
      ? preferredHost
      : addresses[0]?.address;
  if (!chosen) {
    throw new Error(
      'No network connection found. Join the same Wi-Fi as your phone, or connect it by USB cable with tethering turned on, then try again.',
    );
  }
  const host = chosen;

  const token = randomBytes(24).toString('base64url');
  const { key, cert } = await generateCertificate(host);
  const server = createServer({ key, cert });

  const state: SessionState = {
    token,
    server,
    port: 0,
    host,
    offerReceived: false,
    answer: null,
    pendingForPhone: [],
    idleTimer: setTimeout(() => {
      onEvent({ type: 'expired' });
      void stopPhoneSession();
    }, IDLE_TIMEOUT_MS),
    onEvent,
  };

  server.on('request', (req, res) => {
    handleRequest(state, req, res).catch(() => {
      if (!res.headersSent) send(res, 400, 'Bad request', 'text/plain');
    });
  });
  // A phone that rejects the certificate shows up as a TLS error; it must not
  // take the process down.
  server.on('tlsClientError', () => undefined);
  server.on('clientError', (_err, socket) => socket.destroy());

  const port = await new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    // Port 0 = let the OS pick a free ephemeral port.
    server.listen(0, '0.0.0.0', () => {
      const address = server.address();
      if (address && typeof address === 'object') resolve(address.port);
      else reject(new Error('Could not determine the pairing port'));
    });
  });

  state.port = port;
  session = state;

  return {
    url: buildPairingUrl(host, port, token),
    code: formatPairingCode(token),
    host,
    port,
    addresses,
  };
}

/** The desktop's answer, collected by the phone on its next poll. */
export function setPhoneAnswer(sdp: string): void {
  if (session) session.answer = { sdp, type: 'answer' };
}

/** Queue a desktop ICE candidate for the phone's next poll. */
export function addDesktopCandidate(candidate: unknown): void {
  if (session) session.pendingForPhone.push(candidate);
}

export function phoneSessionActive(): boolean {
  return session !== null;
}

export function stopPhoneSession(): Promise<void> {
  const state = session;
  session = null;
  if (!state) return Promise.resolve();
  clearTimeout(state.idleTimer);
  return new Promise((resolve) => {
    state.server.close(() => resolve());
    // close() waits for keep-alive connections the phone may still hold open.
    state.server.closeAllConnections();
  });
}
