import {
  config as defaultConfig,
  configurationErrorFromMessage,
  type Config,
} from "@radar-ia/config";
import {
  Events,
  type Client,
} from "discord.js";

import {
  buildAdminOpsRuntime,
  registerAdminInteractions,
  registerAdminSlashCommands,
  type AdminOpsRuntime,
} from "./admin/index.js";
import { createClient } from "./client.js";

/** Minimal surface required to start and stop the bot (allows test doubles). */
export type LoginCapableClient = Pick<Client, "login" | "destroy"> &
  Partial<Pick<Client, "on" | "once" | "isReady">>;

export type StartBotOptions = {
  /** Validated config; defaults to the process-wide `@radar-ia/config` proxy. */
  readonly config?: Config;
  /** Injected client for tests; otherwise built via `createClient()`. */
  readonly client?: LoginCapableClient;
  /**
   * When `false`, skip `SIGINT` / `SIGTERM` handlers (tests).
   * Defaults to `true`.
   */
  readonly registerSignals?: boolean;
  /**
   * When `false`, skip admin slash registration + InteractionCreate wiring (tests).
   * Defaults to `true` when the client is a real Discord.js Client.
   */
  readonly enableAdminSurface?: boolean;
  /** Injectable admin runtime (tests). */
  readonly adminRuntime?: AdminOpsRuntime;
};

export type BotHandle = {
  readonly client: LoginCapableClient;
  readonly adminRuntime: AdminOpsRuntime | null;
  /** Destroy the client once; subsequent calls are no-ops. */
  shutdown: (signal?: NodeJS.Signals) => Promise<void>;
};

function registerSignalHandlers(shutdown: (signal: NodeJS.Signals) => Promise<void>): void {
  process.once("SIGINT", () => {
    void shutdown("SIGINT").then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM").then(
      () => process.exit(0),
      () => process.exit(1),
    );
  });
}

function isFullClient(client: LoginCapableClient): client is Client {
  return (
    typeof (client as Client).on === "function" &&
    typeof (client as Client).isReady === "function"
  );
}

/**
 * Connect the Discord client using the validated token from config.
 * Wires admin slash surface (009.1E) when a full client is available.
 * Does not retry or wrap Discord's native reconnection behaviour.
 */
export async function startBot(options: StartBotOptions = {}): Promise<BotHandle> {
  const config = options.config ?? defaultConfig;
  const token = config.discord.token;

  if (token === undefined) {
    throw configurationErrorFromMessage(
      ["DISCORD_TOKEN"],
      "DISCORD_TOKEN is required to start the Discord bot",
    );
  }

  const client = options.client ?? createClient();
  let shuttingDown = false;
  let adminRuntime: AdminOpsRuntime | null = null;

  const enableAdmin =
    options.enableAdminSurface !== false && isFullClient(client);

  if (enableAdmin) {
    adminRuntime =
      options.adminRuntime ??
      buildAdminOpsRuntime({
        config,
        client,
      });

    registerAdminInteractions({
      client,
      config,
      runtime: adminRuntime,
    });

    client.once(Events.ClientReady, () => {
      void registerAdminSlashCommands({ config, client }).then(
        (result) => {
          if (result.registered) {
            console.info("Discord admin slash commands registered");
          } else {
            console.warn(
              `Discord admin slash commands skipped (${result.reason ?? "unknown"})`,
            );
          }
        },
        (error: unknown) => {
          console.error("Failed to register Discord admin slash commands:", error);
        },
      );
    });
  }

  async function shutdown(signal?: NodeJS.Signals): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    try {
      if (signal !== undefined) {
        console.info(`Shutting down Discord bot (${signal})`);
      }
      if (adminRuntime !== null) {
        await adminRuntime.disconnect();
      }
      client.destroy();
    } catch (error) {
      console.error("Error during Discord bot shutdown:", error);
      throw error;
    }
  }

  if (options.registerSignals !== false) {
    registerSignalHandlers(shutdown);
  }

  await client.login(token);

  return { client, adminRuntime, shutdown };
}
