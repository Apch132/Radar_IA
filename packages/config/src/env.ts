import { ZodError } from "zod";

import {
  ConfigurationError,
  configurationErrorFromMessage,
  configurationErrorFromZod,
} from "./errors.js";
import { resolveSourcesRegistryPath } from "./paths.js";
import { envSchema, type LogLevel, type NodeEnv, type ParsedEnv } from "./schema.js";

export type { LogLevel, NodeEnv };

/** Frozen publication rules already locked in documentation (no env inventaire). */
export interface PublicationConfig {
  readonly threadArchiveDurationHours: 24;
}

export interface AppConfig {
  readonly nodeEnv: NodeEnv;
  readonly logLevel: LogLevel;
  readonly host: string;
  readonly port: number;
}

export interface DatabaseConfig {
  readonly url: string;
}

export interface DiscordConfig {
  readonly token: string | undefined;
  readonly clientId: string | undefined;
  readonly guildId: string | undefined;
  /** Allowlisted Discord user IDs for admin slash ops (009.1E). Roles forbidden. */
  readonly adminUserIds: readonly string[];
  readonly channels: {
    readonly annoncesMajeures: string | undefined;
    readonly veillePertinente: string | undefined;
    readonly fluxIa: string | undefined;
  };
}

export interface OllamaConfig {
  readonly baseUrl: string;
  /** Exact Ollama model tag; functional target remains Ministral 3 3B. */
  readonly model: string;
  readonly maxConcurrency: 1;
}

/**
 * Source registry file path (definition SoT; runtime backoff stays in DB).
 * Relative `SOURCES_REGISTRY_PATH` values are resolved to an absolute path
 * against the monorepo root (not `process.cwd()`), so npm workspace launches
 * from `apps/bot` / `apps/worker` still find `config/sources.json`.
 */
export interface SourcesConfig {
  readonly registryPath: string;
  readonly rawFeedRetentionPerSource: number;
  readonly rawFeedRetentionDays: number;
}

/**
 * Dedicated worker / pipeline scheduler settings (009.1D).
 * No editorial or 006–008 override knobs.
 */
export interface WorkerConfig {
  readonly schedulerEnabled: boolean;
  readonly cycleIntervalMs: number;
  readonly initialDelayMs: number;
  readonly lockTtlMs: number;
  readonly heartbeatIntervalMs: number;
  readonly holderPrefix: string;
}

/**
 * Validated runtime configuration, organized by domain.
 */
export interface Config {
  readonly app: AppConfig;
  readonly database: DatabaseConfig;
  readonly discord: DiscordConfig;
  readonly ollama: OllamaConfig;
  readonly publication: PublicationConfig;
  readonly sources: SourcesConfig;
  readonly worker: WorkerConfig;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) {
      deepFreeze(child);
    }
  }
  return value;
}

function normalizeEnvInput(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === "") {
      out[key] = undefined;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function assertDiscordForProduction(parsed: ParsedEnv): void {
  if (parsed.NODE_ENV !== "production") {
    return;
  }

  const missing: string[] = [];
  if (!parsed.DISCORD_TOKEN) missing.push("DISCORD_TOKEN");
  if (!parsed.DISCORD_CLIENT_ID) missing.push("DISCORD_CLIENT_ID");
  if (!parsed.DISCORD_GUILD_ID) missing.push("DISCORD_GUILD_ID");
  if (!parsed.DISCORD_CHANNEL_ANNONCES_MAJEURES) {
    missing.push("DISCORD_CHANNEL_ANNONCES_MAJEURES");
  }
  if (!parsed.DISCORD_CHANNEL_VEILLE_PERTINENTE) {
    missing.push("DISCORD_CHANNEL_VEILLE_PERTINENTE");
  }
  if (!parsed.DISCORD_CHANNEL_FLUX_IA) {
    missing.push("DISCORD_CHANNEL_FLUX_IA");
  }

  if (missing.length > 0) {
    throw configurationErrorFromMessage(
      missing,
      `Discord variables are required when NODE_ENV=production: ${missing.join(", ")}`,
    );
  }
}

function toConfig(parsed: ParsedEnv): Config {
  return deepFreeze({
    app: {
      nodeEnv: parsed.NODE_ENV,
      logLevel: parsed.LOG_LEVEL,
      host: parsed.API_HOST,
      port: parsed.API_PORT,
    },
    database: {
      url: parsed.DATABASE_URL,
    },
    discord: {
      token: parsed.DISCORD_TOKEN,
      clientId: parsed.DISCORD_CLIENT_ID,
      guildId: parsed.DISCORD_GUILD_ID,
      adminUserIds: Object.freeze([
        ...new Set(parsed.DISCORD_ADMIN_USER_IDS ?? []),
      ]),
      channels: {
        annoncesMajeures: parsed.DISCORD_CHANNEL_ANNONCES_MAJEURES,
        veillePertinente: parsed.DISCORD_CHANNEL_VEILLE_PERTINENTE,
        fluxIa: parsed.DISCORD_CHANNEL_FLUX_IA,
      },
    },
    ollama: {
      baseUrl: parsed.OLLAMA_BASE_URL,
      model: parsed.OLLAMA_MODEL,
      maxConcurrency: 1 as const,
    },
    publication: {
      threadArchiveDurationHours: 24 as const,
    },
    sources: {
      registryPath: resolveSourcesRegistryPath(parsed.SOURCES_REGISTRY_PATH),
      rawFeedRetentionPerSource: parsed.RAW_FEED_RETENTION_PER_SOURCE,
      rawFeedRetentionDays: parsed.RAW_FEED_RETENTION_DAYS,
    },
    worker: {
      schedulerEnabled: parsed.WORKER_SCHEDULER_ENABLED,
      cycleIntervalMs: parsed.WORKER_CYCLE_INTERVAL_MS,
      initialDelayMs: parsed.WORKER_INITIAL_DELAY_MS,
      lockTtlMs: parsed.PIPELINE_LOCK_TTL_MS,
      heartbeatIntervalMs: parsed.PIPELINE_HEARTBEAT_INTERVAL_MS,
      holderPrefix: parsed.WORKER_HOLDER_PREFIX,
    },
  });
}

/**
 * Parse and validate an environment map into a typed, immutable `Config`.
 * Does not load `.env` files — callers / runtime must populate `process.env`.
 */
export function createConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Config {
  try {
    const normalized = normalizeEnvInput(env);
    const parsed = envSchema.parse(normalized);
    assertDiscordForProduction(parsed);
    return toConfig(parsed);
  } catch (error) {
    if (error instanceof ConfigurationError) {
      throw error;
    }
    if (error instanceof ZodError) {
      throw configurationErrorFromZod(error);
    }
    throw error;
  }
}
