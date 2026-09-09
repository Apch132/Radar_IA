export {
  ConfigurationError,
  configurationErrorFromMessage,
  configurationErrorFromZod,
} from "./errors.js";
export {
  createConfig,
  type AppConfig,
  type Config,
  type DatabaseConfig,
  type DiscordConfig,
  type LogLevel,
  type NodeEnv,
  type OllamaConfig,
  type PublicationConfig,
  type SourcesConfig,
  type WorkerConfig,
} from "./env.js";
export {
  SECRET_ENV_KEYS,
  envSchema,
  DEFAULT_SOURCES_REGISTRY_PATH,
  DEFAULT_WORKER_CYCLE_INTERVAL_MS,
  DEFAULT_WORKER_INITIAL_DELAY_MS,
  DEFAULT_PIPELINE_LOCK_TTL_MS,
  DEFAULT_PIPELINE_HEARTBEAT_INTERVAL_MS,
  DEFAULT_RAW_FEED_RETENTION_PER_SOURCE,
  DEFAULT_RAW_FEED_RETENTION_DAYS,
  DEFAULT_WORKER_HOLDER_PREFIX,
  WORKER_HOLDER_PREFIX_MAX_LENGTH,
  WORKER_CYCLE_INTERVAL_MS_MAX,
  WORKER_INITIAL_DELAY_MS_MAX,
  PIPELINE_LOCK_TTL_MS_MAX,
  PIPELINE_HEARTBEAT_INTERVAL_MS_MAX,
} from "./schema.js";
export {
  findMonorepoRoot,
  resolveSourcesRegistryPath,
} from "./paths.js";

import { createConfig, type Config } from "./env.js";

let cachedConfig: Config | undefined;

function loadConfig(): Config {
  if (cachedConfig === undefined) {
    cachedConfig = createConfig(process.env);
  }
  return cachedConfig;
}

/**
 * Process-wide configuration, validated once on first access.
 * Prefer this entry point from applications; use `createConfig` in tests.
 */
export const config: Config = new Proxy({} as Config, {
  get(_target, property, receiver) {
    return Reflect.get(loadConfig() as object, property, receiver);
  },
});
