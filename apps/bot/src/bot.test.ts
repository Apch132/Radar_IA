import { describe, expect, it, vi } from "vitest";
import { ConfigurationError, createConfig } from "@radar-ia/config";
import { Events, GatewayIntentBits } from "discord.js";

import { startBot, type LoginCapableClient } from "./bot.js";
import { createClient } from "./client.js";
import { registerEvents } from "./events/index.js";

const TEST_ENV = {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgresql://radar:changeme@localhost:5432/radar_ia",
  OLLAMA_MODEL: "example-ministral-tag",
} as const;

const TEST_TOKEN = "test-discord-token-not-real-XYZ";

function createMockClient(): LoginCapableClient & {
  login: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
} {
  return {
    login: vi.fn().mockResolvedValue("ok"),
    destroy: vi.fn(),
  };
}

describe("registerEvents", () => {
  it("registers only ClientReady and error technical listeners on createClient", () => {
    const client = createClient();

    try {
      expect(typeof registerEvents).toBe("function");
      expect(client.listenerCount(Events.ClientReady)).toBe(1);
      expect(client.listenerCount(Events.Error)).toBe(1);
      expect(client.listenerCount(Events.MessageCreate)).toBe(0);
      // InteractionCreate is wired by startBot admin surface, not createClient alone.
      expect(client.listenerCount(Events.InteractionCreate)).toBe(0);
      expect(client.listenerCount(Events.GuildCreate)).toBe(0);
    } finally {
      client.destroy();
    }
  });
});

describe("createClient", () => {
  it("enables only the Guilds and GuildMessages intents", () => {
    const client = createClient();

    try {
      expect(client.options.intents.has(GatewayIntentBits.Guilds)).toBe(true);
      expect(client.options.intents.has(GatewayIntentBits.GuildMessages)).toBe(true);
      expect(client.options.intents.has(GatewayIntentBits.MessageContent)).toBe(false);
      expect(client.options.intents.has(GatewayIntentBits.GuildMembers)).toBe(false);
      expect(client.options.intents.has(GatewayIntentBits.GuildPresences)).toBe(false);
    } finally {
      client.destroy();
    }
  });

  it("wires technical events via the central registry", () => {
    const client = createClient();

    try {
      expect(client.listenerCount(Events.ClientReady)).toBe(1);
      expect(client.listenerCount(Events.Error)).toBe(1);
    } finally {
      client.destroy();
    }
  });
});

describe("startBot", () => {
  it("calls login with the token from validated configuration", async () => {
    const config = createConfig({
      ...TEST_ENV,
      DISCORD_TOKEN: TEST_TOKEN,
      DISCORD_CLIENT_ID: "client-id",
      DISCORD_GUILD_ID: "123456789012345678",
    });
    const client = createMockClient();

    await startBot({ config, client, registerSignals: false });

    expect(client.login).toHaveBeenCalledTimes(1);
    expect(client.login).toHaveBeenCalledWith(TEST_TOKEN);
    expect(client.destroy).not.toHaveBeenCalled();
  });

  it("does not open a real Discord network connection when a client is injected", async () => {
    const config = createConfig({
      ...TEST_ENV,
      DISCORD_TOKEN: TEST_TOKEN,
    });
    const client = createMockClient();

    await startBot({ config, client, registerSignals: false });

    expect(client.login).toHaveBeenCalled();
  });

  it("fails explicitly when DISCORD_TOKEN is missing without leaking secrets", async () => {
    const config = createConfig({ ...TEST_ENV });

    let caught: unknown;
    try {
      await startBot({ config, client: createMockClient(), registerSignals: false });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ConfigurationError);
    const message = caught instanceof Error ? caught.message : String(caught);
    expect(message).toContain("DISCORD_TOKEN");
    expect(message).not.toContain(TEST_TOKEN);
    expect(message).not.toMatch(/postgresql:\/\/[^\s]+/i);
  });

  it("calls destroy once on shutdown and ignores a second close", async () => {
    const config = createConfig({
      ...TEST_ENV,
      DISCORD_TOKEN: TEST_TOKEN,
    });
    const client = createMockClient();

    const handle = await startBot({ config, client, registerSignals: false });

    await handle.shutdown("SIGTERM");
    await handle.shutdown("SIGINT");

    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it("does not leak the token in startup failure logs", async () => {
    const secretToken = "discord-super-secret-token-value-ABC123";
    const config = createConfig({
      ...TEST_ENV,
      DISCORD_TOKEN: secretToken,
    });

    const loginError = new Error("login failed");
    const client = {
      login: vi.fn().mockRejectedValue(loginError),
      destroy: vi.fn(),
    };

    const errors: unknown[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };

    try {
      await expect(
        startBot({ config, client, registerSignals: false }),
      ).rejects.toThrow(loginError);
    } finally {
      console.error = originalError;
    }

    const serialized = JSON.stringify(errors);
    expect(serialized).not.toContain(secretToken);
  });
});
