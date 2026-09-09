import type { FastifyInstance } from "fastify";

/**
 * Internal liveness probe. Intentionally minimal — no env, DB, Discord, or Ollama details.
 */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ status: "ok" as const }));
}
