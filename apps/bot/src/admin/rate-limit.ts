/**
 * In-memory admin slash rate limiter (010.1A AUD-019).
 * Keyed by actorId + operation. No external dependency.
 */

export type AdminRateLimitResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterMs: number };

const DEFAULT_COOLDOWNS_MS: Readonly<Record<string, number>> = {
  status: 3_000,
  health: 5_000,
  sources: 3_000,
  interventions: 3_000,
  cycle: 15_000,
  resume: 15_000,
  reanalyse: 15_000,
};

export type AdminRateLimiter = {
  check(actorId: string, operation: string, now?: number): AdminRateLimitResult;
};

export function createAdminRateLimiter(
  cooldownsMs: Readonly<Record<string, number>> = DEFAULT_COOLDOWNS_MS,
): AdminRateLimiter {
  const lastAllowed = new Map<string, number>();

  return {
    check(actorId, operation, now = Date.now()) {
      const cooldown = cooldownsMs[operation] ?? 5_000;
      const key = `${actorId}:${operation}`;
      const previous = lastAllowed.get(key);
      if (previous !== undefined) {
        const elapsed = now - previous;
        if (elapsed < cooldown) {
          return { allowed: false, retryAfterMs: cooldown - elapsed };
        }
      }
      lastAllowed.set(key, now);
      return { allowed: true };
    },
  };
}
