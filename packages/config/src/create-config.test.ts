import { isAbsolute, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { ConfigurationError } from "./errors.js";
import { createConfig } from "./env.js";
import { findMonorepoRoot } from "./paths.js";

const BASE_ENV = {
  DATABASE_URL: "postgresql://radar:changeme@localhost:5432/radar_ia",
  OLLAMA_MODEL: "example-ministral-tag",
} as const;

describe("createConfig", () => {
  it("accepts a minimal valid configuration", () => {
    const config = createConfig({ ...BASE_ENV });

    expect(config.app.nodeEnv).toBe("development");
    expect(config.app.logLevel).toBe("info");
    expect(config.app.host).toBe("127.0.0.1");
    expect(config.app.port).toBe(3000);
    expect(config.database.url).toBe(BASE_ENV.DATABASE_URL);
    expect(config.discord.token).toBeUndefined();
    expect(config.discord.channels.annoncesMajeures).toBeUndefined();
    expect(config.discord.channels.veillePertinente).toBeUndefined();
    expect(config.discord.channels.fluxIa).toBeUndefined();
    expect(config.discord.adminUserIds).toEqual([]);
    expect(config.ollama.baseUrl).toBe("http://localhost:11434");
    expect(config.ollama.model).toBe(BASE_ENV.OLLAMA_MODEL);
    expect(config.ollama.maxConcurrency).toBe(1);
    expect(config.publication.threadArchiveDurationHours).toBe(24);
    expect(isAbsolute(config.sources.registryPath)).toBe(true);
    expect(config.sources.registryPath).toBe(
      resolve(findMonorepoRoot(), "config/sources.json"),
    );
    expect(config.worker.schedulerEnabled).toBe(true);
    expect(config.worker.cycleIntervalMs).toBe(15 * 60_000);
    expect(config.worker.initialDelayMs).toBe(5_000);
    expect(config.worker.lockTtlMs).toBe(5 * 60_000);
    expect(config.worker.heartbeatIntervalMs).toBe(30_000);
    expect(config.worker.holderPrefix).toBe("worker");
  });

  it("parses worker and sources overrides", () => {
    const config = createConfig({
      ...BASE_ENV,
      SOURCES_REGISTRY_PATH: "config/alt.json",
      WORKER_SCHEDULER_ENABLED: "false",
      WORKER_CYCLE_INTERVAL_MS: "120000",
      WORKER_INITIAL_DELAY_MS: "0",
      PIPELINE_LOCK_TTL_MS: "60000",
      PIPELINE_HEARTBEAT_INTERVAL_MS: "5000",
      WORKER_HOLDER_PREFIX: "w",
    });
    expect(config.sources.registryPath).toBe(
      resolve(findMonorepoRoot(), "config/alt.json"),
    );
    expect(config.worker.schedulerEnabled).toBe(false);
    expect(config.worker.cycleIntervalMs).toBe(120_000);
    expect(config.worker.initialDelayMs).toBe(0);
    expect(config.worker.lockTtlMs).toBe(60_000);
    expect(config.worker.heartbeatIntervalMs).toBe(5_000);
    expect(config.worker.holderPrefix).toBe("w");
  });

  it("resolves SOURCES_REGISTRY_PATH from monorepo root even when cwd is apps/bot", () => {
    const root = findMonorepoRoot();
    const previous = process.cwd();
    try {
      process.chdir(join(root, "apps", "bot"));
      const config = createConfig({ ...BASE_ENV });
      expect(config.sources.registryPath).toBe(
        resolve(root, "config/sources.json"),
      );
    } finally {
      process.chdir(previous);
    }
  });

  it("keeps absolute SOURCES_REGISTRY_PATH unchanged", () => {
    const absolute = resolve("/var", "radar", "sources.json");
    const config = createConfig({
      ...BASE_ENV,
      SOURCES_REGISTRY_PATH: absolute,
    });
    expect(config.sources.registryPath).toBe(absolute);
  });

  it("rejects out-of-range WORKER_CYCLE_INTERVAL_MS", () => {
    expect(() =>
      createConfig({
        ...BASE_ENV,
        WORKER_CYCLE_INTERVAL_MS: String(25 * 60 * 60_000),
      }),
    ).toThrow(ConfigurationError);
  });

  it("converts API_PORT to an integer", () => {
    const config = createConfig({ ...BASE_ENV, API_PORT: "4050" });
    expect(config.app.port).toBe(4050);
    expect(typeof config.app.port).toBe("number");
  });

  it("rejects an invalid API_PORT", () => {
    expect(() => createConfig({ ...BASE_ENV, API_PORT: "not-a-port" })).toThrow(
      ConfigurationError,
    );
    expect(() => createConfig({ ...BASE_ENV, API_PORT: "70000" })).toThrow(
      ConfigurationError,
    );
  });

  it("rejects a non-PostgreSQL DATABASE_URL", () => {
    expect(() =>
      createConfig({
        ...BASE_ENV,
        DATABASE_URL: "mysql://radar:changeme@localhost:3306/radar_ia",
      }),
    ).toThrow(ConfigurationError);
  });

  it("defaults OLLAMA_MAX_CONCURRENCY to 1", () => {
    const config = createConfig({ ...BASE_ENV });
    expect(config.ollama.maxConcurrency).toBe(1);
  });

  it("rejects OLLAMA_MAX_CONCURRENCY different from 1", () => {
    expect(() =>
      createConfig({ ...BASE_ENV, OLLAMA_MAX_CONCURRENCY: "2" }),
    ).toThrow(ConfigurationError);
  });

  it("never leaks DISCORD_TOKEN in error messages", () => {
    const secret = "discord-super-secret-token-value-XYZ";
    try {
      createConfig({
        NODE_ENV: "production",
        DATABASE_URL: "not-a-url",
        DISCORD_TOKEN: secret,
        DISCORD_CLIENT_ID: "123",
        DISCORD_GUILD_ID: "123456789012345678",
        DISCORD_CHANNEL_ANNONCES_MAJEURES: "223456789012345678",
        DISCORD_CHANNEL_VEILLE_PERTINENTE: "323456789012345678",
        DISCORD_CHANNEL_FLUX_IA: "423456789012345678",
        OLLAMA_MODEL: BASE_ENV.OLLAMA_MODEL,
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const message = String(error);
      expect(message).not.toContain(secret);
      expect(message).toContain("DATABASE_URL");
    }
  });

  it("never leaks DATABASE_URL password in error messages", () => {
    const password = "super-secret-db-password-ABC";
    const url = `postgresql://radar:${password}@localhost:5432/radar_ia`;
    try {
      createConfig({
        ...BASE_ENV,
        DATABASE_URL: url,
        API_PORT: "bad-port",
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const message = String(error);
      expect(message).not.toContain(password);
      expect(message).not.toContain(url);
      expect(message).toContain("API_PORT");
    }
  });

  it("allows Discord secrets to be omitted outside production", () => {
    const config = createConfig({
      ...BASE_ENV,
      NODE_ENV: "development",
    });
    expect(config.discord.token).toBeUndefined();
    expect(config.discord.clientId).toBeUndefined();
    expect(config.discord.guildId).toBeUndefined();
    expect(config.discord.channels.annoncesMajeures).toBeUndefined();
  });

  it("requires Discord secrets in production", () => {
    expect(() =>
      createConfig({
        ...BASE_ENV,
        NODE_ENV: "production",
      }),
    ).toThrow(ConfigurationError);

    try {
      createConfig({
        ...BASE_ENV,
        NODE_ENV: "production",
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const message = String(error);
      expect(message).toContain("DISCORD_TOKEN");
      expect(message).toContain("DISCORD_CLIENT_ID");
      expect(message).toContain("DISCORD_GUILD_ID");
      expect(message).toContain("DISCORD_CHANNEL_ANNONCES_MAJEURES");
      expect(message).toContain("DISCORD_CHANNEL_VEILLE_PERTINENTE");
      expect(message).toContain("DISCORD_CHANNEL_FLUX_IA");
    }

    const config = createConfig({
      ...BASE_ENV,
      NODE_ENV: "production",
      DISCORD_TOKEN: "token-example",
      DISCORD_CLIENT_ID: "client-example",
      DISCORD_GUILD_ID: "123456789012345678",
      DISCORD_CHANNEL_ANNONCES_MAJEURES: "223456789012345678",
      DISCORD_CHANNEL_VEILLE_PERTINENTE: "323456789012345678",
      DISCORD_CHANNEL_FLUX_IA: "423456789012345678",
    });
    expect(config.discord.token).toBe("token-example");
    expect(config.app.nodeEnv).toBe("production");
    expect(config.discord.channels.annoncesMajeures).toBe("223456789012345678");
  });

  it("rejects invalid Discord snowflakes", () => {
    expect(() =>
      createConfig({
        ...BASE_ENV,
        DISCORD_GUILD_ID: "guild-example",
      }),
    ).toThrow(ConfigurationError);
  });

  it("parses DISCORD_ADMIN_USER_IDS allowlist (user IDs only)", () => {
    const config = createConfig({
      ...BASE_ENV,
      DISCORD_ADMIN_USER_IDS:
        "123456789012345678, 223456789012345678,123456789012345678",
    });
    expect(config.discord.adminUserIds).toEqual([
      "123456789012345678",
      "223456789012345678",
    ]);
  });

  it("rejects invalid admin user IDs in allowlist", () => {
    expect(() =>
      createConfig({
        ...BASE_ENV,
        DISCORD_ADMIN_USER_IDS: "not-a-snowflake",
      }),
    ).toThrow(ConfigurationError);
  });

  it("requires OLLAMA_MODEL with no coded default", () => {
    expect(() =>
      createConfig({
        DATABASE_URL: BASE_ENV.DATABASE_URL,
      }),
    ).toThrow(ConfigurationError);
  });
});
