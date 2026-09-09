import { config } from "@radar-ia/config";
import type { FastifyInstance } from "fastify";

import { buildApp } from "./app.js";

let appInstance: FastifyInstance | undefined;
let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;

  const app = appInstance;
  if (app === undefined) {
    process.exit(0);
    return;
  }

  try {
    app.log.info({ signal }, "Shutting down");
    await app.close();
    process.exit(0);
  } catch (error) {
    app.log.error({ err: error, signal }, "Error during shutdown");
    process.exit(1);
  }
}

function registerSignalHandlers(): void {
  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

/**
 * Start the HTTP server using validated `@radar-ia/config` values.
 * Fails explicitly if configuration is invalid (thrown by config load).
 */
export async function startServer(): Promise<FastifyInstance> {
  const app = await buildApp({ config });
  appInstance = app;

  registerSignalHandlers();

  const { host, port } = config.app;
  await app.listen({ host, port });
  app.log.info({ host, port }, "API listening");

  return app;
}
