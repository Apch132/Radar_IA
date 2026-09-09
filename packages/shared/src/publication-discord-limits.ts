/**
 * Discord API limits retained by gel 008.1A §8.5.
 * Centralized — do not duplicate elsewhere in the publication path.
 */
export const DISCORD_LIMITS = {
  MESSAGE_CONTENT: 2000,
  EMBED_TITLE: 256,
  EMBED_DESCRIPTION: 4096,
  EMBED_FIELD_NAME: 256,
  EMBED_FIELD_VALUE: 1024,
  EMBED_FIELDS_MAX: 25,
  EMBED_FOOTER: 2048,
  /** Sum of title + description + fields + footer text. */
  EMBED_TOTAL: 6000,
  THREAD_NAME: 100,
  /** Max sources shown in the Sources field (gel 008.1A §8.2). */
  SOURCES_DISPLAY_MAX: 5,
} as const;

export type DiscordLimitKey = keyof typeof DISCORD_LIMITS;

/** Unicode ellipsis used for deterministic truncation. */
export const TRUNCATION_ELLIPSIS = "…";
