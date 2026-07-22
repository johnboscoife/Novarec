import Fastify from 'fastify';
import { z } from 'zod';

/**
 * @novarec/server — the Fastify signaling service. Phase 8 adds LiveKit room
 * tokens (short-TTL JWTs) and optional share links. Phase 0 ships a health
 * endpoint so the service is wired into the workspace and CI.
 */
const HealthSchema = z.object({
  status: z.literal('ok'),
  service: z.string(),
  uptimeSec: z.number().nonnegative(),
});

const app = Fastify({ logger: true });

app.get('/health', () => {
  return HealthSchema.parse({
    status: 'ok',
    service: 'novarec-server',
    uptimeSec: Math.round(process.uptime()),
  });
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
