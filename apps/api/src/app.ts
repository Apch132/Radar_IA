import Fastify, { type FastifyInstance } from "fastify";
import type { Config } from "@radar-ia/config";

import { registerRoutes } from "./routes/index.js";

export type BuildAppOptions = {
  readonly config: Config;
  /** Override Fastify logger (tests typically pass `false`). */
  readonly logger?: boolean | { level: Config["app"]["logLevel"] };
};

/**
 * Build a Fastify application instance without listening.
 * Safe to use with `app.inject()` in tests.
 */
export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { config } = options;
  const logger =
    options.logger === undefined
      ? { level: config.app.logLevel }
      : options.logger;

  const app = Fastify({
    logger,
  });

  await registerRoutes(app);

  return app;
}
