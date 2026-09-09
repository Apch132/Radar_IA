import { describe, expect, it } from "vitest";
import { createConfig } from "@radar-ia/config";

import { buildApp } from "./app.js";
import { registerRoutes } from "./routes/index.js";

const TEST_ENV = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgresql://radar:changeme@localhost:5432/radar_ia",
  OLLAMA_MODEL: "example-ministral-tag",
} as const;

describe("registerRoutes", () => {
  it("is the central registration point that exposes GET /health", async () => {
    const config = createConfig({ ...TEST_ENV });
    const app = await buildApp({ config, logger: false });

    try {
      expect(typeof registerRoutes).toBe("function");
      expect(app.hasRoute({ method: "GET", url: "/health" })).toBe(true);

      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: "ok" });
    } finally {
      await app.close();
    }
  });
});

describe("buildApp", () => {
  it("builds an application and serves GET /health via the central route registry", async () => {
    const config = createConfig({ ...TEST_ENV });
    const app = await buildApp({ config, logger: false });

    try {
      expect(app.hasRoute({ method: "GET", url: "/health" })).toBe(true);

      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toMatch(/application\/json/);
      expect(response.json()).toEqual({ status: "ok" });
    } finally {
      await app.close();
    }
  });

  it("does not leak sensitive configuration in /health", async () => {
    const secretToken = "discord-super-secret-token-value-XYZ";
    const databaseUrl = "postgresql://radar:secret-db-password@localhost:5432/radar_ia";

    const config = createConfig({
      ...TEST_ENV,
      DATABASE_URL: databaseUrl,
      DISCORD_TOKEN: secretToken,
      DISCORD_CLIENT_ID: "client-id",
      DISCORD_GUILD_ID: "123456789012345678",
    });

    const app = await buildApp({ config, logger: false });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/health",
      });

      const body = response.body;
      const payload = response.json() as Record<string, unknown>;

      expect(response.statusCode).toBe(200);
      expect(Object.keys(payload)).toEqual(["status"]);
      expect(body).not.toContain(secretToken);
      expect(body).not.toContain("secret-db-password");
      expect(body).not.toContain(databaseUrl);
      expect(body).not.toContain("DISCORD_TOKEN");
      expect(body).not.toContain("DATABASE_URL");
    } finally {
      await app.close();
    }
  });

  it("closes cleanly after inject", async () => {
    const config = createConfig({ ...TEST_ENV });
    const app = await buildApp({ config, logger: false });

    await app.inject({ method: "GET", url: "/health" });
    await expect(app.close()).resolves.toBeUndefined();
  });
});
