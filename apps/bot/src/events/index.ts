import { Events, type Client } from "discord.js";

/**
 * Central registration point for technical Discord events.
 * Future business handlers register elsewhere without cluttering `createClient()`.
 */
export function registerEvents(client: Client): void {
  client.once(Events.ClientReady, (readyClient) => {
    const identity = readyClient.user.tag || readyClient.user.id;
    console.info(`Discord client ready (${identity})`);
  });

  client.on(Events.Error, (error) => {
    console.error("Discord client error:", error);
  });
}
