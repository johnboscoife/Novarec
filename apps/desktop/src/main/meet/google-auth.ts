import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app, net, safeStorage, shell } from 'electron';
import { z } from 'zod';
import { GoogleProfileSchema, type GoogleProfile } from '@novarec/shared';
import { loadAppSettings } from '../app-settings-store.js';

/**
 * In-app Google sign-in for the Meet section, done the right way for a desktop
 * app: an OAuth 2.0 Authorization Code + PKCE flow over a localhost loopback
 * redirect. The system browser handles the actual Google login (Google blocks
 * logging in inside embedded webviews), we catch the redirect on 127.0.0.1, and
 * exchange the code for tokens. Tokens never touch the renderer — only the
 * resulting profile does.
 *
 * The refresh token is encrypted at rest with Electron safeStorage (DPAPI on
 * Windows). Client credentials come from Settings (the user's own Google Cloud
 * "Desktop app" client), so nothing sensitive is baked into the build.
 */

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const MEET_SPACES_ENDPOINT = 'https://meet.googleapis.com/v2/spaces';

const SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/meetings.space.created',
];

const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

const TokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string().optional(),
  expires_in: z.number().optional(),
});

const UserinfoSchema = z.object({
  email: z.string().optional(),
  name: z.string().optional(),
  picture: z.string().optional(),
});

const SpaceSchema = z.object({ meetingUri: z.string().optional() });

interface StoredTokens {
  refreshToken: string; // base64 ciphertext when `enc`, else plaintext
  enc: boolean;
  profile: GoogleProfile;
}

function tokenFile(): string {
  return join(app.getPath('userData'), 'google-tokens.json');
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

async function credentials(): Promise<{ clientId: string; clientSecret: string }> {
  const settings = await loadAppSettings();
  if (!settings.googleClientId || !settings.googleClientSecret) {
    throw new Error('Add your Google OAuth client ID and secret in Settings → Google first.');
  }
  return { clientId: settings.googleClientId, clientSecret: settings.googleClientSecret };
}

const HTML_OK =
  '<!doctype html><meta charset="utf-8"><title>NovaRec</title>' +
  '<body style="font:16px system-ui;background:#0b0b0f;color:#e8e8ee;display:grid;place-items:center;height:100vh;margin:0">' +
  '<div style="text-align:center"><h2>Signed in to NovaRec</h2><p>You can close this tab and return to the app.</p></div>';
const HTML_FAIL =
  '<!doctype html><meta charset="utf-8"><title>NovaRec</title>' +
  '<body style="font:16px system-ui;background:#0b0b0f;color:#e8e8ee;display:grid;place-items:center;height:100vh;margin:0">' +
  '<div style="text-align:center"><h2>Sign-in failed</h2><p>You can close this tab and try again.</p></div>';

interface Loopback {
  redirectUri: string;
  waitForCode(expectedState: string): Promise<string>;
  close(): void;
}

/** Start a one-request loopback server and report the redirect URI it listens on. */
function startLoopback(): Promise<Loopback> {
  return new Promise((resolve, reject) => {
    let expected = '';
    let onCode: ((code: string) => void) | null = null;
    let onErr: ((err: Error) => void) | null = null;

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (url.pathname !== '/') {
        res.statusCode = 404;
        res.end();
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const error = url.searchParams.get('error');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (error || !code || state !== expected) {
        res.end(HTML_FAIL);
        onErr?.(new Error(error ?? 'Invalid sign-in response'));
        return;
      }
      res.end(HTML_OK);
      onCode?.(code);
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        redirectUri: `http://127.0.0.1:${port}`,
        waitForCode: (expectedState) =>
          new Promise<string>((resolveCode, rejectCode) => {
            expected = expectedState;
            onCode = resolveCode;
            onErr = rejectCode;
            setTimeout(() => rejectCode(new Error('Sign-in timed out')), SIGN_IN_TIMEOUT_MS);
          }),
        close: () => server.close(),
      });
    });
  });
}

async function postForm(endpoint: string, form: Record<string, string>): Promise<unknown> {
  const response = await net.fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Google request failed (${response.status}). ${detail.slice(0, 200)}`);
  }
  return response.json();
}

async function fetchProfile(accessToken: string): Promise<GoogleProfile> {
  const response = await net.fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Could not fetch your Google profile (${response.status})`);
  const info = UserinfoSchema.parse(await response.json());
  return {
    email: info.email ?? '',
    name: info.name ?? info.email ?? 'Google account',
    picture: info.picture ?? null,
  };
}

async function readStored(): Promise<StoredTokens | null> {
  try {
    const raw: unknown = JSON.parse(await readFile(tokenFile(), 'utf8'));
    const parsed = z
      .object({ refreshToken: z.string(), enc: z.boolean(), profile: GoogleProfileSchema })
      .safeParse(raw);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function storeTokens(refreshToken: string, profile: GoogleProfile): Promise<void> {
  const enc = safeStorage.isEncryptionAvailable();
  const stored: StoredTokens = {
    refreshToken: enc ? safeStorage.encryptString(refreshToken).toString('base64') : refreshToken,
    enc,
    profile,
  };
  const file = tokenFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(stored), 'utf8');
}

function decryptRefresh(stored: StoredTokens): string {
  if (!stored.refreshToken) throw new Error('Not signed in to Google');
  if (stored.enc) return safeStorage.decryptString(Buffer.from(stored.refreshToken, 'base64'));
  return stored.refreshToken;
}

/** Exchange a stored refresh token for a fresh access token. */
async function getAccessToken(): Promise<string> {
  const stored = await readStored();
  if (!stored) throw new Error('Not signed in to Google');
  const { clientId, clientSecret } = await credentials();
  const tokens = TokenResponseSchema.parse(
    await postForm(TOKEN_ENDPOINT, {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: decryptRefresh(stored),
      grant_type: 'refresh_token',
    }),
  );
  return tokens.access_token;
}

/** Run the interactive OAuth flow and persist the result. */
export async function signIn(): Promise<GoogleProfile> {
  const { clientId, clientSecret } = await credentials();
  const { verifier, challenge } = pkce();
  const state = base64url(randomBytes(16));
  const loopback = await startLoopback();

  try {
    const authUrl = new URL(AUTH_ENDPOINT);
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', loopback.redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', SCOPES.join(' '));
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');
    authUrl.searchParams.set('state', state);

    await shell.openExternal(authUrl.toString());
    const code = await loopback.waitForCode(state);

    const tokens = TokenResponseSchema.parse(
      await postForm(TOKEN_ENDPOINT, {
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: loopback.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    );
    if (!tokens.refresh_token) {
      throw new Error('Google did not return a refresh token — try signing in again.');
    }
    const profile = await fetchProfile(tokens.access_token);
    await storeTokens(tokens.refresh_token, profile);
    return profile;
  } finally {
    loopback.close();
  }
}

export async function signOut(): Promise<void> {
  await rm(tokenFile(), { force: true }).catch(() => undefined);
}

export async function getProfile(): Promise<GoogleProfile | null> {
  const stored = await readStored();
  return stored?.profile ?? null;
}

/** Create a real Google Meet space via the Meet REST API; returns its join URL. */
export async function createMeet(): Promise<string> {
  const accessToken = await getAccessToken();
  const response = await net.fetch(MEET_SPACES_ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Couldn't create a Google Meet (${response.status}). ${detail.slice(0, 200)}`);
  }
  const space = SpaceSchema.parse(await response.json());
  if (!space.meetingUri) throw new Error('The Meet API did not return a meeting link.');
  return space.meetingUri;
}
