import Fastify from 'fastify';
import { z } from 'zod';
import { buildAccessToken, grantForRole } from './livekit-token.js';

/**
 * @novarec/server — the Fastify signaling service. Issues short-TTL LiveKit room
 * tokens (Phase 8) and exposes a health endpoint. Schemas are declared inline so
 * the service stays free of the source-only @novarec/shared at runtime.
 */
const HealthSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  uptimeSec: z.number().nonnegative(),
});

const TokenBodySchema = z.object({
  identity: z.string().min(1),
  name: z.string().optional(),
  role: z.enum(['host', 'participant']),
});
const TokenParamsSchema = z.object({ room: z.string().min(1) });

const TOKEN_TTL_SECONDS = 600;

const app = Fastify({ logger: true });

app.get('/health', () => {
  return HealthSchema.parse({
    status: 'ok',
    service: 'novarec-server',
    uptimeSec: Math.round(process.uptime()),
  });
});

app.post('/rooms/:room/token', (request) => {
  const { room } = TokenParamsSchema.parse(request.params);
  const body = TokenBodySchema.parse(request.body);
  const apiKey = process.env['LIVEKIT_API_KEY'] ?? 'devkey';
  const apiSecret = process.env['LIVEKIT_API_SECRET'] ?? 'devsecret';
  const nowSeconds = Math.floor(Date.now() / 1000);

  const token = buildAccessToken(
    {
      apiKey,
      apiSecret,
      identity: body.identity,
      ttlSeconds: TOKEN_TTL_SECONDS,
      grant: grantForRole(room, body.role),
      ...(body.name ? { name: body.name } : {}),
    },
    nowSeconds,
  );

  return {
    token,
    room,
    ...(process.env['LIVEKIT_URL'] ? { url: process.env['LIVEKIT_URL'] } : {}),
  };
});

const port = Number(process.env['PORT'] ?? 8787);

async function main(): Promise<void> {
  try {
    await app.listen({ port, host: '127.0.0.1' });
  } catch (error: unknown) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
