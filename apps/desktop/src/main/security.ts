import { session } from 'electron';

/**
 * Content Security Policy installed as a response header (authoritative — a
 * <meta> CSP is weaker and can't cover every response). Production is strict;
 * development loosens only what Vite's HMR/react-refresh genuinely needs.
 */
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  // https:/wss: are required so a user's LiveKit server (any host they configure)
  // and its TURN/region endpoints are reachable — they can't be enumerated at
  // build time. This is broad, but the risk is contained: script-src 'self' plus
  // the navigation lock (main/index.ts) block injected/attacker code, and secrets
  // (LiveKit/Google) are never handed to the renderer, so there's nothing here to
  // exfiltrate. Accepted tradeoff for the meetings feature.
  "connect-src 'self' https: wss:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'", // the app embeds no iframes
  "form-action 'none'", // no form ever POSTs anywhere
  "frame-ancestors 'none'",
].join('; ');

const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self' http://localhost:* ws://localhost:* https: wss:",
  "worker-src 'self' blob:",
  "object-src 'none'",
].join('; ');

export function installContentSecurityPolicy(isDev: boolean): void {
  const csp = isDev ? DEV_CSP : PROD_CSP;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}
