import { REST, Routes, type Client } from "discord.js";
import type { Config } from "@radar-ia/config";

import { buildAdminSlashCommandBodies } from "./commands.js";

export type RegisterAdminCommandsOptions = {
  readonly config: Config;
  readonly client: Client;
};

/**
 * Register guild-scoped admin slash commands via Discord REST.
 * No-op when clientId / guildId / token are missing (dev without Discord).
 */
export async function registerAdminSlashCommands(
  options: RegisterAdminCommandsOptions,
): Promise<{ registered: boolean; reason?: string }> {
  const { config, client } = options;
  const token = config.discord.token;
  const clientId = config.discord.clientId;
  const guildId = config.discord.guildId;

  if (token === undefined || clientId === undefined || guildId === undefined) {
    return {
      registered: false,
      reason: "DISCORD_TOKEN / DISCORD_CLIENT_ID / DISCORD_GUILD_ID required",
    };
  }

  const rest = new REST({ version: "10" }).setToken(token);
  const body = buildAdminSlashCommandBodies();

  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body,
  });

  // Ensure application id is known on the client when available.
  if (client.application !== null) {
    // no-op — REST registration is authoritative for guild commands
  }

  return { registered: true };
}
