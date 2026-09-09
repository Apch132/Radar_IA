import type { FastifyInstance } from "fastify";

import { healthRoutes } from "./health.js";

/**
 * Central registration point for technical API routes.
 * Future route groups register here without modifying `buildApp()`.
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
}
