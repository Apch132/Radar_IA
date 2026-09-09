import { Client, GatewayIntentBits } from "discord.js";

import { registerEvents } from "./events/index.js";

/**
 * Build a minimal Discord.js client for bootstrap.
 * Publication V1 needs guild metadata plus guild message/thread operations only.
 */
export function createClient(): Client {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  registerEvents(client);

  return client;
}
