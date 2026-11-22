import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ServerConfig } from './config.js';
import { buildAccessToken, grantForRole } from './livekit-token.js';

/**
 * The Fastify signaling service: issues short-TTL LiveKit room tokens and
 * exposes a health endpoint. Built by a function (rather than at import) so the
 * routes can be exercised in tests with `app.inject`, without a socket.
 */
const HealthSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  uptimeSec: z.number().nonnegative(),
});

/** Room names and identities end up in JWT claims and LiveKit logs; keep them tame. */
const NAME_PATTERN = /^[A-Za-z0-9_.-]+$/;

const TokenBodySchema = z.object({
  identity: z.string().min(1).max(128).regex(NAME_PATTERN),
  name: z.string().min(1).max(128).optional(),
  role: z.enum(['host', 'participant']),
});
const TokenParamsSchema = z.object({ room: z.string().min(1).max(128).regex(NAME_PATTERN) });

const TOKEN_TTL_SECONDS = 600;

/** Constant-time check of the `Authorization: Bearer <secret>` header. */
export function isAuthorized(header: string | undefined, secret: string): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const given = Buffer.from(header.slice('Bearer '.length));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function buildApp(
  config: ServerConfig,
  options: { logger?: boolean; now?: () => number } = {},
): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });
  const now = options.now ?? (() => Date.now());

  app.get('/health', () =>
    HealthSchema.parse({
      status: 'ok',
      service: 'novarec-server',
      uptimeSec: Math.round(process.uptime()),
    }),
  );

  app.post('/rooms/:room/token', async (request, reply) => {
    if (!isAuthorized(request.headers.authorization, config.serverSecret)) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    const params = TokenParamsSchema.safeParse(request.params);
    const body = TokenBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      // A malformed request is the caller's fault: 400, not a 500.
      return reply.code(400).send({ error: 'Invalid room, identity, name or role' });
    }
    const { room } = params.data;
    const token = buildAccessToken(
      {
        apiKey: config.livekitApiKey,
        apiSecret: config.livekitApiSecret,
        identity: body.data.identity,
        ttlSeconds: TOKEN_TTL_SECONDS,
        grant: grantForRole(room, body.data.role),
        ...(body.data.name ? { name: body.data.name } : {}),
      },
      Math.floor(now() / 1000),
    );
    return { token, room, ...(config.livekitUrl ? { url: config.livekitUrl } : {}) };
  });

  return app;
}
