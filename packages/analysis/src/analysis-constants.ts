/** Gel 007.1A §10 — timeouts / retries (client Ollama). */

export const OLLAMA_INFERENCE_TIMEOUT_MS = 90_000;
export const OLLAMA_QUEUE_TIMEOUT_MS = 300_000;
export const OLLAMA_MAX_ATTEMPTS = 3;
export const OLLAMA_MAX_CONCURRENCY = 1 as const;
/** Max Ollama HTTP response body size (010.1A AUD-016). */
export const OLLAMA_MAX_RESPONSE_BYTES = 1_000_000;

/** Delay before 2nd and 3rd attempts (gel 007.1A §10.2). */
export const OLLAMA_RETRY_DELAYS_MS = [5_000, 15_000] as const;

/** Gel 007.1A §6.1 — text budgets (Unicode code points after trim). */
export const SUMMARY_MIN_LENGTH = 40;
export const SUMMARY_MAX_LENGTH = 500;
export const RATIONALE_MAX_LENGTH = 280;

/** Gel 007.1A §6.2 — list budgets. */
export const ENTITIES_MAX_COUNT = 12;
export const ENTITY_MAX_LENGTH = 80;
export const PROPOSED_FACTS_MAX_COUNT = 8;
export const FACT_KEY_MAX_LENGTH = 64;
export const FACT_VALUE_MAX_LENGTH = 200;
export const SECONDARY_CATEGORIES_MAX_COUNT = 3;
