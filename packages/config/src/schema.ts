import { z } from "zod";

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

const NODE_ENVS = ["development", "test", "production"] as const;

/** Environment variable names treated as secrets (never echo values in errors). */
export const SECRET_ENV_KEYS = ["DISCORD_TOKEN", "DATABASE_URL"] as const;

const nonEmptyString = z.string().trim().min(1, { message: "must be a non-empty string" });

const portSchema = z
  .string()
  .trim()
  .min(1, { message: "must be a non-empty string" })
  .refine((value) => /^\d+$/.test(value), { message: "must be an integer" })
  .transform((value) => Number.parseInt(value, 10))
  .refine((value) => Number.isInteger(value) && value >= 1 && value <= 65535, {
    message: "must be an integer between 1 and 65535",
  });

const positiveIntSchema = z
  .string()
  .trim()
  .min(1, { message: "must be a non-empty string" })
  .refine((value) => /^\d+$/.test(value), { message: "must be an integer" })
  .transform((value) => Number.parseInt(value, 10))
  .refine((value) => Number.isInteger(value) && value >= 1, {
    message: "must be a positive integer",
  });

const postgresUrlSchema = nonEmptyString.refine(
  (value) => {
    try {
      const url = new URL(value);
      return url.protocol === "postgresql:" || url.protocol === "postgres:";
    } catch {
      return false;
    }
  },
  { message: "must be a valid PostgreSQL URL (postgres:// or postgresql://)" },
);

const optionalNonEmpty = z
  .string()
  .trim()
  .min(1, { message: "must be a non-empty string" })
  .optional();

const optionalSnowflake = z
  .string()
  .trim()
  .min(1, { message: "must be a non-empty string" })
  .refine((value) => /^\d{17,20}$/.test(value), {
    message: "must be a Discord snowflake (17 to 20 digits)",
  })
  .optional();

const booleanEnvSchema = z
  .string()
  .trim()
  .min(1, { message: "must be a non-empty string" })
  .transform((value) => value.toLowerCase())
  .refine((value) => value === "true" || value === "false", {
    message: 'must be "true" or "false"',
  })
  .transform((value) => value === "true");

/** Bounded positive integer env (inclusive max). */
function boundedPositiveIntSchema(max: number, label: string) {
  return positiveIntSchema.refine((value) => value <= max, {
    message: `must be an integer between 1 and ${max} (${label})`,
  });
}

/**
 * Default source registry path relative to the monorepo root.
 * Resolved to an absolute path in `createConfig` (not via `process.cwd()`).
 */
export const DEFAULT_SOURCES_REGISTRY_PATH = "config/sources.json";

/** Default cycle interval: 15 minutes. */
export const DEFAULT_WORKER_CYCLE_INTERVAL_MS = 15 * 60_000;

/** Default delay before the first cycle: 5 seconds. */
export const DEFAULT_WORKER_INITIAL_DELAY_MS = 5_000;

/** Aligns with `@radar-ia/database` DEFAULT_PIPELINE_LOCK_TTL_MS. */
export const DEFAULT_PIPELINE_LOCK_TTL_MS = 5 * 60_000;

/** Aligns with `@radar-ia/database` DEFAULT_PIPELINE_HEARTBEAT_INTERVAL_MS. */
export const DEFAULT_PIPELINE_HEARTBEAT_INTERVAL_MS = 30_000;
export const DEFAULT_RAW_FEED_RETENTION_PER_SOURCE = 20;
export const DEFAULT_RAW_FEED_RETENTION_DAYS = 30;

/** Default holder id prefix (no secrets). */
export const DEFAULT_WORKER_HOLDER_PREFIX = "worker";

/** Holder id prefix max length (full id is further bounded in the worker). */
export const WORKER_HOLDER_PREFIX_MAX_LENGTH = 32;

/** Cycle interval max: 24 hours. */
export const WORKER_CYCLE_INTERVAL_MS_MAX = 24 * 60 * 60_000;

/** Initial delay max: 1 hour. */
export const WORKER_INITIAL_DELAY_MS_MAX = 60 * 60_000;

/** Lock TTL max: 1 hour. */
export const PIPELINE_LOCK_TTL_MS_MAX = 60 * 60_000;

/** Heartbeat interval max: 10 minutes. */
export const PIPELINE_HEARTBEAT_INTERVAL_MS_MAX = 10 * 60_000;

/**
 * Raw environment schema (stringly-typed inputs from process.env).
 * Empty strings should be normalized to `undefined` before parse.
 * Discord production rules are applied in `createConfig`.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default("development"),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  API_HOST: nonEmptyString.default("127.0.0.1"),
  API_PORT: portSchema.optional().transform((value) => value ?? 3000),

  DATABASE_URL: postgresUrlSchema,

  DISCORD_TOKEN: optionalNonEmpty,
  DISCORD_CLIENT_ID: optionalNonEmpty,
  DISCORD_GUILD_ID: optionalSnowflake,
  DISCORD_CHANNEL_ANNONCES_MAJEURES: optionalSnowflake,
  DISCORD_CHANNEL_VEILLE_PERTINENTE: optionalSnowflake,
  DISCORD_CHANNEL_FLUX_IA: optionalSnowflake,
  /**
   * Allowlist of Discord user snowflakes (comma-separated).
   * Admin slash commands (009.1E) — user IDs only, never roles.
   */
  DISCORD_ADMIN_USER_IDS: z
    .string()
    .trim()
    .optional()
    .transform((value) => {
      if (value === undefined || value === "") {
        return [] as string[];
      }
      return value
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    })
    .pipe(
      z.array(
        z
          .string()
          .regex(/^\d{17,20}$/, {
            message: "must be a Discord snowflake (17 to 20 digits)",
          }),
      ),
    ),

  OLLAMA_BASE_URL: nonEmptyString.default("http://localhost:11434"),
  /** Exact Ollama model tag (Modelfile / install). Functional target: Ministral 3 3B. */
  OLLAMA_MODEL: nonEmptyString,
  /**
   * Doctrine: exactly one concurrent inference.
   * Default 1; any other value is rejected.
   */
  OLLAMA_MAX_CONCURRENCY: positiveIntSchema
    .optional()
    .transform((value) => value ?? 1)
    .refine((value) => value === 1, {
      message: "must be 1 (single concurrent inference doctrine)",
    }),

  /** Path to the JSON source registry (file = definition SoT). */
  SOURCES_REGISTRY_PATH: nonEmptyString.default(DEFAULT_SOURCES_REGISTRY_PATH),

  /**
   * When true, schedule cycles after the first run.
   * When false, run a single cycle (one-shot) then stop.
   */
  WORKER_SCHEDULER_ENABLED: booleanEnvSchema
    .optional()
    .transform((value) => value ?? true),

  /** Delay between the end of one cycle and the start of the next. */
  WORKER_CYCLE_INTERVAL_MS: boundedPositiveIntSchema(
    WORKER_CYCLE_INTERVAL_MS_MAX,
    "WORKER_CYCLE_INTERVAL_MS",
  )
    .optional()
    .transform((value) => value ?? DEFAULT_WORKER_CYCLE_INTERVAL_MS),

  /** Short delay before the first cycle after worker ready. */
  WORKER_INITIAL_DELAY_MS: z
    .string()
    .trim()
    .min(1, { message: "must be a non-empty string" })
    .refine((value) => /^\d+$/.test(value), { message: "must be an integer" })
    .transform((value) => Number.parseInt(value, 10))
    .refine(
      (value) =>
        Number.isInteger(value) &&
        value >= 0 &&
        value <= WORKER_INITIAL_DELAY_MS_MAX,
      {
        message: `must be an integer between 0 and ${WORKER_INITIAL_DELAY_MS_MAX}`,
      },
    )
    .optional()
    .transform((value) => value ?? DEFAULT_WORKER_INITIAL_DELAY_MS),

  /** Single-flight lock TTL (ms) passed to the pipeline orchestrator. */
  PIPELINE_LOCK_TTL_MS: boundedPositiveIntSchema(
    PIPELINE_LOCK_TTL_MS_MAX,
    "PIPELINE_LOCK_TTL_MS",
  )
    .optional()
    .transform((value) => value ?? DEFAULT_PIPELINE_LOCK_TTL_MS),

  /** Heartbeat interval while a cycle holds the lock. */
  PIPELINE_HEARTBEAT_INTERVAL_MS: boundedPositiveIntSchema(
    PIPELINE_HEARTBEAT_INTERVAL_MS_MAX,
    "PIPELINE_HEARTBEAT_INTERVAL_MS",
  )
    .optional()
    .transform((value) => value ?? DEFAULT_PIPELINE_HEARTBEAT_INTERVAL_MS),

  RAW_FEED_RETENTION_PER_SOURCE: boundedPositiveIntSchema(
    500,
    "RAW_FEED_RETENTION_PER_SOURCE",
  )
    .optional()
    .transform((value) => value ?? DEFAULT_RAW_FEED_RETENTION_PER_SOURCE),
  RAW_FEED_RETENTION_DAYS: boundedPositiveIntSchema(
    3650,
    "RAW_FEED_RETENTION_DAYS",
  )
    .optional()
    .transform((value) => value ?? DEFAULT_RAW_FEED_RETENTION_DAYS),

  /** Stable prefix for the process holder id (no secrets). */
  WORKER_HOLDER_PREFIX: nonEmptyString
    .max(WORKER_HOLDER_PREFIX_MAX_LENGTH, {
      message: `must be at most ${WORKER_HOLDER_PREFIX_MAX_LENGTH} characters`,
    })
    .refine((value) => /^[a-zA-Z0-9_-]+$/.test(value), {
      message: "must contain only letters, digits, underscore, or hyphen",
    })
    .default(DEFAULT_WORKER_HOLDER_PREFIX),
}).superRefine((value, ctx) => {
  if (value.PIPELINE_HEARTBEAT_INTERVAL_MS >= value.PIPELINE_LOCK_TTL_MS / 3) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["PIPELINE_HEARTBEAT_INTERVAL_MS"],
      message: "must be less than one third of PIPELINE_LOCK_TTL_MS",
    });
  }
});

export type ParsedEnv = z.infer<typeof envSchema>;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type NodeEnv = (typeof NODE_ENVS)[number];
