import { Client, GatewayIntentBits } from "discord.js";

/**
 * Publication-only Discord client for the worker (008.1E port host).
 * Intents match the gelled publication surface — no MessageContent, no slash.
 */
export function createWorkerDiscordClient(): Client {
  return new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });
}

export const WORKER_DISCORD_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
] as const;

export type WorkerDiscordHandle = {
  readonly client: Client;
  readonly isReady: () => boolean;
  login(token: string): Promise<void>;
  destroy(): void;
};

/**
 * Wrap a Discord.js client with ready tracking and one-shot destroy.
 */
export function createWorkerDiscordHandle(
  client: Client = createWorkerDiscordClient(),
): WorkerDiscordHandle {
  let ready = false;
  let destroyed = false;

  client.once("ready", () => {
    ready = true;
  });

  return {
    client,
    isReady: () => ready && !destroyed,
    async login(token) {
      await client.login(token);
    },
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      ready = false;
      client.destroy();
    },
  };
}
