import {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  type Client,
  type Message,
  type Snowflake,
} from "discord.js";
import type {
  DiscordEmbedPayload,
  DiscordEmbedFieldPayload,
  RenderedDiscordPayload,
} from "@radar-ia/shared";
import type { DiscordPublicationPort } from "@radar-ia/database";

import {
  normalizeDiscordError,
  throwPublicationPortError,
} from "./discord-publication-errors.js";

type DiscordPublicationClient = Pick<Client, "channels" | "user">;
type FetchedChannel = Awaited<
  ReturnType<DiscordPublicationClient["channels"]["fetch"]>
>;

type PublicationGuildTextChannel = NonNullable<FetchedChannel> & {
  readonly guild: { readonly id: string };
  isTextBased(): boolean;
  isSendable(): boolean;
  permissionsFor(userId: string): { has(permission: bigint): boolean } | null;
  send(payload: ReturnType<typeof toMessagePayload>): Promise<{ id: string }>;
  messages: {
    fetch(messageId: Snowflake): Promise<Message>;
  };
};

type PublicationThreadChannel = NonNullable<FetchedChannel> & {
  readonly type: ChannelType.PublicThread;
  readonly archived: boolean;
  readonly locked: boolean;
  isSendable(): boolean;
  permissionsFor(userId: string): { has(permission: bigint): boolean } | null;
  setArchived(archived: boolean, reason?: string): Promise<unknown>;
  send(payload: ReturnType<typeof toMessagePayload>): Promise<{ id: string }>;
};

const SAFE_ALLOWED_MENTIONS = {
  parse: [] as const,
  users: [] as const,
  roles: [] as const,
  repliedUser: false,
};

function toEmbedBuilder(embed: DiscordEmbedPayload): EmbedBuilder {
  const builder = new EmbedBuilder();

  if (embed.title !== undefined) {
    builder.setTitle(embed.title);
  }
  if (embed.description !== undefined) {
    builder.setDescription(embed.description);
  }
  if (embed.url !== undefined) {
    builder.setURL(embed.url);
  }
  if (embed.footer?.text !== undefined) {
    builder.setFooter({ text: embed.footer.text });
  }
  if (embed.fields !== undefined && embed.fields.length > 0) {
    builder.addFields(
      embed.fields.map((field: DiscordEmbedFieldPayload) => ({
        name: field.name,
        value: field.value,
        inline: field.inline ?? false,
      })),
    );
  }

  return builder;
}

function toMessagePayload(content: RenderedDiscordPayload) {
  return {
    content: content.content,
    embeds: content.embeds.map(toEmbedBuilder),
    allowedMentions: SAFE_ALLOWED_MENTIONS,
  };
}

function isGuildTextChannel(channel: FetchedChannel): boolean {
  return (
    channel !== null &&
    "guild" in channel &&
    typeof channel.isTextBased === "function" &&
    channel.isTextBased() &&
    typeof (channel as { isSendable?: unknown }).isSendable === "function" &&
    "messages" in channel
  );
}

function isThreadChannel(channel: FetchedChannel): boolean {
  return channel !== null && channel.type === ChannelType.PublicThread;
}

function requireClientUserId(client: DiscordPublicationClient): string {
  const id = client.user?.id?.trim();
  if (!id) {
    throwPublicationPortError(
      "channel_unavailable",
      "Discord client user is unavailable",
      { retryable: true },
    );
  }
  return id;
}

function requireGuildTextChannel(
  channel: FetchedChannel,
  channelId: string,
): PublicationGuildTextChannel {
  if (channel === null) {
    throwPublicationPortError(
      "channel_unavailable",
      `Discord channel not found: ${channelId}`,
      { retryable: true },
    );
  }
  if (!isGuildTextChannel(channel)) {
    throwPublicationPortError(
      "channel_unavailable",
      `Discord channel is not a guild text channel: ${channelId}`,
      { retryable: false },
    );
  }
  if (typeof channel.isSendable !== "function" || !channel.isSendable()) {
    throwPublicationPortError(
      "channel_unavailable",
      `Discord channel is not sendable: ${channelId}`,
      { retryable: true },
    );
  }
  return channel as PublicationGuildTextChannel;
}

function requirePublicThread(
  channel: FetchedChannel,
  threadId: string,
): PublicationThreadChannel {
  if (channel === null) {
    throwPublicationPortError(
      "inconsistent_state",
      `Discord thread not found: ${threadId}`,
      { retryable: false },
    );
  }
  if (!isThreadChannel(channel)) {
    throwPublicationPortError(
      "channel_unavailable",
      `Discord channel is not a public thread: ${threadId}`,
      { retryable: false },
    );
  }
  if (typeof channel.isSendable !== "function" || !channel.isSendable()) {
    throwPublicationPortError(
      "channel_unavailable",
      `Discord thread is not sendable: ${threadId}`,
      { retryable: true },
    );
  }
  return channel as PublicationThreadChannel;
}

function requirePermissions(
  channel: PublicationGuildTextChannel | PublicationThreadChannel,
  clientUserId: string,
  permissions: readonly bigint[],
  resourceLabel: string,
): void {
  const permissionSet = channel.permissionsFor(clientUserId);
  if (permissionSet === null) {
    throwPublicationPortError(
      "missing_permission",
      `Unable to resolve Discord permissions for ${resourceLabel}`,
      { retryable: false },
    );
  }

  for (const permission of permissions) {
    if (!permissionSet.has(permission)) {
      throwPublicationPortError(
        "missing_permission",
        `Missing Discord permission ${String(permission)} on ${resourceLabel}`,
        { retryable: false },
      );
    }
  }
}

async function fetchStarterMessage(
  channel: PublicationGuildTextChannel,
  messageId: Snowflake,
): Promise<Message> {
  try {
    return await (channel.messages.fetch(messageId) as Promise<Message>);
  } catch (error) {
    normalizeDiscordError(error, {
      unknownCode: "inconsistent_state",
      unknownMessage: `Unable to fetch main publication message ${messageId}`,
    });
  }
}

async function fetchChannel(
  client: DiscordPublicationClient,
  channelId: string,
  fallback: { unknownCode?: Parameters<typeof normalizeDiscordError>[1]["unknownCode"]; unknownMessage: string },
) {
  try {
    return await client.channels.fetch(channelId);
  } catch (error) {
    normalizeDiscordError(error, fallback);
  }
}

export function createDiscordPublicationAdapter(
  client: DiscordPublicationClient,
): DiscordPublicationPort {
  return {
    async sendMainMessage(input) {
      const clientUserId = requireClientUserId(client);
      const channel = requireGuildTextChannel(
        await fetchChannel(client, input.channelId, {
          unknownCode: "channel_unavailable",
          unknownMessage: `Unable to fetch Discord channel ${input.channelId}`,
        }),
        input.channelId,
      );

      requirePermissions(
        channel,
        clientUserId,
        [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.CreatePublicThreads,
        ],
        `channel ${input.channelId}`,
      );

      try {
        const message = await channel.send(toMessagePayload(input.content));
        return { messageId: message.id };
      } catch (error) {
        normalizeDiscordError(error, {
          unknownCode: "unknown",
          unknownMessage: `Unable to send main publication message to ${input.channelId}`,
        });
      }
    },

    async startThread(input) {
      const clientUserId = requireClientUserId(client);
      const channel = requireGuildTextChannel(
        await fetchChannel(client, input.channelId, {
          unknownCode: "channel_unavailable",
          unknownMessage: `Unable to fetch Discord channel ${input.channelId}`,
        }),
        input.channelId,
      );

      requirePermissions(
        channel,
        clientUserId,
        [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.CreatePublicThreads,
        ],
        `channel ${input.channelId}`,
      );

      const message = await fetchStarterMessage(channel, input.messageId);

      try {
        const thread = await message.startThread({
          name: input.name,
          autoArchiveDuration: input.autoArchiveMinutes,
        });
        return { threadId: thread.id };
      } catch (error) {
        normalizeDiscordError(error, {
          unknownCode: "unknown",
          unknownMessage: `Unable to create Discord thread from message ${input.messageId}`,
        });
      }
    },

    async unarchiveThreadIfNeeded(input) {
      const clientUserId = requireClientUserId(client);
      const thread = requirePublicThread(
        await fetchChannel(client, input.threadId, {
          unknownCode: "inconsistent_state",
          unknownMessage: `Unable to fetch Discord thread ${input.threadId}`,
        }),
        input.threadId,
      );

      requirePermissions(
        thread,
        clientUserId,
        [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.SendMessagesInThreads,
        ],
        `thread ${input.threadId}`,
      );

      if (!thread.archived) {
        return;
      }

      if (thread.locked) {
        throwPublicationPortError(
          "inconsistent_state",
          `Discord thread is locked: ${input.threadId}`,
          { retryable: false },
        );
      }

      requirePermissions(
        thread,
        clientUserId,
        [PermissionFlagsBits.ManageThreads],
        `thread ${input.threadId}`,
      );

      try {
        await thread.setArchived(false, "Radar IA publication enrichment");
      } catch (error) {
        normalizeDiscordError(error, {
          unknownCode: "inconsistent_state",
          unknownMessage: `Unable to unarchive Discord thread ${input.threadId}`,
        });
      }
    },

    async sendThreadMessage(input) {
      const clientUserId = requireClientUserId(client);
      const thread = requirePublicThread(
        await fetchChannel(client, input.threadId, {
          unknownCode: "inconsistent_state",
          unknownMessage: `Unable to fetch Discord thread ${input.threadId}`,
        }),
        input.threadId,
      );

      requirePermissions(
        thread,
        clientUserId,
        [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.SendMessagesInThreads,
          PermissionFlagsBits.EmbedLinks,
        ],
        `thread ${input.threadId}`,
      );

      if (thread.archived) {
        throwPublicationPortError(
          "inconsistent_state",
          `Discord thread is archived and must be re-opened first: ${input.threadId}`,
          { retryable: false },
        );
      }
      if (thread.locked) {
        throwPublicationPortError(
          "inconsistent_state",
          `Discord thread is locked: ${input.threadId}`,
          { retryable: false },
        );
      }

      try {
        const message = await thread.send(toMessagePayload(input.content));
        return { messageId: message.id };
      } catch (error) {
        normalizeDiscordError(error, {
          unknownCode: "unknown",
          unknownMessage: `Unable to send enrichment message to thread ${input.threadId}`,
        });
      }
    },

    async fetchMessage(input) {
      const channel = requireGuildTextChannel(
        await fetchChannel(client, input.channelId, {
          unknownCode: "channel_unavailable",
          unknownMessage: `Unable to fetch Discord channel ${input.channelId}`,
        }),
        input.channelId,
      );

      try {
        await channel.messages.fetch(input.messageId as Snowflake);
        return { exists: true };
      } catch (error) {
        if (error instanceof Error && /unknown message/i.test(error.message)) {
          return { exists: false };
        }
        normalizeDiscordError(error, {
          unknownCode: "inconsistent_state",
          unknownMessage: `Unable to fetch Discord message ${input.messageId}`,
        });
      }
    },
  };
}

export type { DiscordPublicationClient, RenderedDiscordPayload };
