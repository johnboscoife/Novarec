/**
 * Server configuration, read from the environment once at startup.
 *
 * Every secret is REQUIRED. The service used to fall back to LiveKit's
 * `devkey`/`devsecret` when they were missing, which quietly signed real
 * tokens with a publicly known secret; it now refuses to start instead.
 */
export interface ServerConfig {
  livekitApiKey: string;
  livekitApiSecret: string;
  livekitUrl: string | null;
  /**
   * Shared secret callers must present as `Authorization: Bearer <secret>`.
   * Token issuance is the whole job of this service, so it is never open.
   */
  serverSecret: string;
  port: number;
}

/** Long enough that it cannot be guessed; short secrets are a config mistake. */
const MIN_SECRET_LENGTH = 32;

export function loadConfig(env: Record<string, string | undefined>): ServerConfig {
  const missing = ['LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'NOVAREC_SERVER_SECRET'].filter(
    (name) => !env[name],
  );
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  const serverSecret = env['NOVAREC_SERVER_SECRET'] ?? '';
  if (serverSecret.length < MIN_SECRET_LENGTH) {
    throw new Error(`NOVAREC_SERVER_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  const port = Number(env['PORT'] ?? 8787);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be a valid port number, got "${env['PORT'] ?? ''}"`);
  }
  return {
    livekitApiKey: env['LIVEKIT_API_KEY'] ?? '',
    livekitApiSecret: env['LIVEKIT_API_SECRET'] ?? '',
    livekitUrl: env['LIVEKIT_URL'] || null,
    serverSecret,
    port,
  };
}
