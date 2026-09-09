import { describe, expect, it, vi } from "vitest";
import { ConfigurationError, type Config } from "@radar-ia/config";
import { DiscordAPIError } from "discord.js";
import type { RenderedDiscordPayload } from "@radar-ia/shared";
import { DiscordPublicationPortError } from "@radar-ia/database";

import {
  createDiscordPublicationAdapter,
  createPublicationChannelResolver,
} from "./index.js";

const CHANNEL_ID = "123456789012345678";
const THREAD_ID = "223456789012345678";
const MESSAGE_ID = "323456789012345678";

const PAYLOAD: RenderedDiscordPayload = {
  content: "Radar IA @everyone",
  embeds: [
    {
      title: "Titre",
      description: "Resume",
      fields: [{ name: "Catégorie", value: "model_release" }],
      footer: { text: "dossier:12345678" },
    },
  ],
};

function createRuntimeConfig(
  overrides: Partial<Config["discord"]["channels"]> = {},
): Config {
  return {
    app: {
      nodeEnv: "test",
      logLevel: "silent",
      host: "0.0.0.0",
      port: 3000,
    },
    database: {
      url: "postgresql://radar:changeme@localhost:5432/radar_ia",
    },
    discord: {
      token: undefined,
      clientId: undefined,
      guildId: "123456789012345678",
      channels: {
        annoncesMajeures: undefined,
        veillePertinente: undefined,
        fluxIa: undefined,
        ...overrides,
      },
    },
    ollama: {
      baseUrl: "http://localhost:11434",
      model: "example-ministral-tag",
      maxConcurrency: 1,
    },
    publication: {
      threadArchiveDurationHours: 24,
    },
  };
}

function permissionSet(hasAll = true) {
  return {
    has: vi.fn(() => hasAll),
  };
}

function createMessageDouble() {
  return {
    id: MESSAGE_ID,
    startThread: vi.fn(async () => ({ id: THREAD_ID })),
  };
}

function createTextChannelDouble(overrides: Record<string, unknown> = {}) {
  const message = createMessageDouble();
  return {
    id: CHANNEL_ID,
    type: 0,
    guild: { id: "guild_1" },
    isTextBased: () => true,
    isSendable: () => true,
    permissionsFor: vi.fn(() => permissionSet(true)),
    send: vi.fn(async (payload) => ({ id: MESSAGE_ID, payload })),
    messages: {
      fetch: vi.fn(async () => message),
    },
    __message: message,
    ...overrides,
  };
}

function createThreadDouble(overrides: Record<string, unknown> = {}) {
  return {
    id: THREAD_ID,
    type: 11,
    archived: false,
    locked: false,
    isTextBased: () => true,
    isSendable: () => true,
    permissionsFor: vi.fn(() => permissionSet(true)),
    send: vi.fn(async (payload) => ({ id: "423456789012345678", payload })),
    setArchived: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createClientDouble(
  channels: Record<string, unknown>,
  userId = "523456789012345678",
) {
  return {
    user: { id: userId },
    channels: {
      fetch: vi.fn(async (id: string) => channels[id] ?? null),
    },
  };
}

describe("createDiscordPublicationAdapter", () => {
  it("sends the main message with safe allowedMentions and one embed", async () => {
    const textChannel = createTextChannelDouble();
    const client = createClientDouble({ [CHANNEL_ID]: textChannel });
    const adapter = createDiscordPublicationAdapter(client as never);

    const result = await adapter.sendMainMessage({
      channelId: CHANNEL_ID,
      content: PAYLOAD,
    });

    expect(result).toEqual({ messageId: MESSAGE_ID });
    expect(textChannel.send).toHaveBeenCalledTimes(1);
    expect(textChannel.send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: PAYLOAD.content,
        embeds: expect.any(Array),
        allowedMentions: {
          parse: [],
          users: [],
          roles: [],
          repliedUser: false,
        },
      }),
    );
  });

  it("creates the thread from the starter message with 1440 minutes", async () => {
    const textChannel = createTextChannelDouble();
    const client = createClientDouble({ [CHANNEL_ID]: textChannel });
    const adapter = createDiscordPublicationAdapter(client as never);

    const result = await adapter.startThread({
      channelId: CHANNEL_ID,
      messageId: MESSAGE_ID,
      name: "Veille - OpenAI GPT-5",
      autoArchiveMinutes: 1440,
    });

    expect(result).toEqual({ threadId: THREAD_ID });
    expect(textChannel.messages.fetch).toHaveBeenCalledWith(MESSAGE_ID);
    expect(textChannel.__message.startThread).toHaveBeenCalledWith({
      name: "Veille - OpenAI GPT-5",
      autoArchiveDuration: 1440,
    });
  });

  it("reopens an archived thread and no-ops when already active", async () => {
    const archivedThread = createThreadDouble({ archived: true });
    const activeThread = createThreadDouble({ archived: false });

    const adapterArchived = createDiscordPublicationAdapter(
      createClientDouble({ [THREAD_ID]: archivedThread }) as never,
    );
    await adapterArchived.unarchiveThreadIfNeeded({ threadId: THREAD_ID });
    expect(archivedThread.setArchived).toHaveBeenCalledWith(
      false,
      "Radar IA publication enrichment",
    );

    const adapterActive = createDiscordPublicationAdapter(
      createClientDouble({ [THREAD_ID]: activeThread }) as never,
    );
    await adapterActive.unarchiveThreadIfNeeded({ threadId: THREAD_ID });
    expect(activeThread.setArchived).not.toHaveBeenCalled();
  });

  it("refuses to reopen or publish to a locked thread", async () => {
    const lockedThread = createThreadDouble({ archived: true, locked: true });
    const adapter = createDiscordPublicationAdapter(
      createClientDouble({ [THREAD_ID]: lockedThread }) as never,
    );

    await expect(
      adapter.unarchiveThreadIfNeeded({ threadId: THREAD_ID }),
    ).rejects.toMatchObject<Partial<DiscordPublicationPortError>>({
      code: "inconsistent_state",
    });

    await expect(
      adapter.sendThreadMessage({ threadId: THREAD_ID, content: PAYLOAD }),
    ).rejects.toMatchObject<Partial<DiscordPublicationPortError>>({
      code: "inconsistent_state",
    });
  });

  it("publishes enrichment only in the thread", async () => {
    const thread = createThreadDouble();
    const adapter = createDiscordPublicationAdapter(
      createClientDouble({ [THREAD_ID]: thread }) as never,
    );

    const result = await adapter.sendThreadMessage({
      threadId: THREAD_ID,
      content: PAYLOAD,
    });

    expect(result).toEqual({ messageId: "423456789012345678" });
    expect(thread.send).toHaveBeenCalledTimes(1);
  });

  it("maps missing channel to channel_unavailable", async () => {
    const adapter = createDiscordPublicationAdapter(
      createClientDouble({}) as never,
    );

    await expect(
      adapter.sendMainMessage({ channelId: CHANNEL_ID, content: PAYLOAD }),
    ).rejects.toMatchObject<Partial<DiscordPublicationPortError>>({
      code: "channel_unavailable",
    });
  });

  it("rejects a non text channel", async () => {
    const adapter = createDiscordPublicationAdapter(
      createClientDouble({
        [CHANNEL_ID]: { id: CHANNEL_ID, isTextBased: () => false },
      }) as never,
    );

    await expect(
      adapter.sendMainMessage({ channelId: CHANNEL_ID, content: PAYLOAD }),
    ).rejects.toMatchObject<Partial<DiscordPublicationPortError>>({
      code: "channel_unavailable",
    });
  });

  it("fails when send permission is missing", async () => {
    const textChannel = createTextChannelDouble({
      permissionsFor: vi.fn(() => permissionSet(false)),
    });
    const adapter = createDiscordPublicationAdapter(
      createClientDouble({ [CHANNEL_ID]: textChannel }) as never,
    );

    await expect(
      adapter.sendMainMessage({ channelId: CHANNEL_ID, content: PAYLOAD }),
    ).rejects.toMatchObject<Partial<DiscordPublicationPortError>>({
      code: "missing_permission",
    });
  });

  it("fails when embed permission is missing in the thread", async () => {
    const thread = createThreadDouble({
      permissionsFor: vi.fn(() => ({
        has: vi
          .fn()
          .mockReturnValueOnce(true)
          .mockReturnValueOnce(true)
          .mockReturnValueOnce(true)
          .mockReturnValueOnce(false),
      })),
    });
    const adapter = createDiscordPublicationAdapter(
      createClientDouble({ [THREAD_ID]: thread }) as never,
    );

    await expect(
      adapter.sendThreadMessage({ threadId: THREAD_ID, content: PAYLOAD }),
    ).rejects.toMatchObject<Partial<DiscordPublicationPortError>>({
      code: "missing_permission",
    });
  });

  it("fails when create thread permission is missing", async () => {
    const textChannel = createTextChannelDouble({
      permissionsFor: vi.fn(() => ({
        has: vi
          .fn()
          .mockReturnValueOnce(true)
          .mockReturnValueOnce(true)
          .mockReturnValueOnce(false),
      })),
    });
    const adapter = createDiscordPublicationAdapter(
      createClientDouble({ [CHANNEL_ID]: textChannel }) as never,
    );

    await expect(
      adapter.startThread({
        channelId: CHANNEL_ID,
        messageId: MESSAGE_ID,
        name: "Veille",
        autoArchiveMinutes: 1440,
      }),
    ).rejects.toMatchObject<Partial<DiscordPublicationPortError>>({
      code: "missing_permission",
    });
  });

  it("normalizes retryable Discord/network errors", async () => {
    const textChannel = createTextChannelDouble({
      send: vi.fn(async () => {
        throw Object.assign(new Error("socket hang up"), {
          code: "ECONNRESET",
        });
      }),
    });
    const adapter = createDiscordPublicationAdapter(
      createClientDouble({ [CHANNEL_ID]: textChannel }) as never,
    );

    await expect(
      adapter.sendMainMessage({ channelId: CHANNEL_ID, content: PAYLOAD }),
    ).rejects.toMatchObject<Partial<DiscordPublicationPortError>>({
      code: "discord_unavailable",
      retryable: true,
    });
  });

  it("normalizes terminal Discord API errors", async () => {
    const textChannel = createTextChannelDouble({
      send: vi.fn(async () => {
        throw new DiscordAPIError({ message: "Missing Permissions", code: 50013 }, 50013, 403, "POST", "", {});
      }),
    });
    const adapter = createDiscordPublicationAdapter(
      createClientDouble({ [CHANNEL_ID]: textChannel }) as never,
    );

    await expect(
      adapter.sendMainMessage({ channelId: CHANNEL_ID, content: PAYLOAD }),
    ).rejects.toMatchObject<Partial<DiscordPublicationPortError>>({
      code: "missing_permission",
      retryable: false,
    });
  });

  it("does not make any real network call in tests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const textChannel = createTextChannelDouble();
    const adapter = createDiscordPublicationAdapter(
      createClientDouble({ [CHANNEL_ID]: textChannel }) as never,
    );

    await adapter.sendMainMessage({ channelId: CHANNEL_ID, content: PAYLOAD });

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("createPublicationChannelResolver", () => {
  it("resolves the three business channels with no fallback", () => {
    const resolver = createPublicationChannelResolver(
      createRuntimeConfig({
        annoncesMajeures: "111111111111111111",
        veillePertinente: "222222222222222222",
        fluxIa: "333333333333333333",
      }),
    );

    expect(resolver("annonces_majeures")).toBe("111111111111111111");
    expect(resolver("veille_pertinente")).toBe("222222222222222222");
    expect(resolver("flux_ia")).toBe("333333333333333333");
  });

  it("returns null when a channel is not configured and does not fallback", () => {
    const resolver = createPublicationChannelResolver(createRuntimeConfig());

    expect(resolver("annonces_majeures")).toBeNull();
    expect(resolver("veille_pertinente")).toBeNull();
    expect(resolver("flux_ia")).toBeNull();
  });

  it("rejects invalid configured snowflakes without leaking secrets", () => {
    const resolver = () =>
      createPublicationChannelResolver(
        createRuntimeConfig({
          annoncesMajeures: "bad-id",
        }),
      );

    expect(resolver).toThrow(ConfigurationError);
  });
});
