import { buildApp } from './app.js';
import { loadConfig, type ServerConfig } from './config.js';

/**
 * @novarec/server entry point. Configuration is validated before anything
 * listens: a missing secret stops the process rather than issuing tokens
 * signed with a default one. Schemas are declared inline so the service stays
 * free of the source-only @novarec/shared at runtime.
 */
async function main(): Promise<void> {
  let config: ServerConfig;
  try {
    config = loadConfig(process.env);
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  const app = buildApp(config);
  try {
    await app.listen({ port: config.port, host: process.env['HOST'] ?? '127.0.0.1' });
  } catch (error: unknown) {
    app.log.error(error);
    process.exit(1);
  }
}

void main();
