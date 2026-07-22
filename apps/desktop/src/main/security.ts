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
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self' http://localhost:* ws://localhost:*",
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
