import type { SourceTier } from "./analysis-service-types.js";

/** Multiplicateurs de tier (gel 007.1A §9.1). */
export const TIER_MULTIPLIERS: Readonly<Record<SourceTier, number>> = {
  S: 1.1,
  A: 1.05,
  B: 1.0,
  C: 0.95,
  D: 0.9,
  E: 0.85,
};

const TIER_RANK: Readonly<Record<SourceTier, number>> = {
  S: 6,
  A: 5,
  B: 4,
  C: 3,
  D: 2,
  E: 1,
};

export function isSourceTier(value: string): value is SourceTier {
  return value in TIER_MULTIPLIERS;
}

export function isTierStrictlyHigher(
  left: SourceTier,
  right: SourceTier,
): boolean {
  return TIER_RANK[left] > TIER_RANK[right];
}

/**
 * Meilleur tier parmi les articles rattachés.
 * Aucun article → E (gel 007.1A §9.1).
 */
export function resolveBestSourceTier(
  tiers: readonly SourceTier[],
): SourceTier {
  if (tiers.length === 0) {
    return "E";
  }
  let best: SourceTier = tiers[0]!;
  for (let i = 1; i < tiers.length; i += 1) {
    const candidate = tiers[i]!;
    if (isTierStrictlyHigher(candidate, best)) {
      best = candidate;
    }
  }
  return best;
}

function clampInt(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export interface BackendScoringInput {
  readonly relevance: number;
  readonly impact: number;
  readonly novelty: number;
  /** Ignoré volontairement (gel 007.1A §9.2). */
  readonly confidence?: number;
  readonly bestSourceTier: SourceTier;
}

export interface BackendScoringResult {
  readonly effectiveRelevance: number;
  readonly effectiveImpact: number;
  readonly composite: number;
  readonly bestSourceTier: SourceTier;
  readonly tierMultiplier: number;
}

/**
 * Scoring effectif backend (gel 007.1A §9.2).
 *
 * ```
 * effectiveRelevance = clamp(0, 100, floor(relevance * tierMultiplier))
 * effectiveImpact    = clamp(0, 100, floor(impact * tierMultiplier))
 * composite          = clamp(0, 100, round(
 *                      0.40 * effectiveRelevance
 *                    + 0.40 * effectiveImpact
 *                    + 0.20 * novelty
 *                    ))
 * ```
 *
 * `novelty` n’est pas multiplié par le tier.
 * `confidence` ne participe pas.
 */
export function computeBackendScoring(
  input: BackendScoringInput,
): BackendScoringResult {
  const tierMultiplier = TIER_MULTIPLIERS[input.bestSourceTier];
  const effectiveRelevance = clampInt(
    Math.floor(input.relevance * tierMultiplier),
    0,
    100,
  );
  const effectiveImpact = clampInt(
    Math.floor(input.impact * tierMultiplier),
    0,
    100,
  );
  const composite = clampInt(
    Math.round(
      0.4 * effectiveRelevance + 0.4 * effectiveImpact + 0.2 * input.novelty,
    ),
    0,
    100,
  );

  return {
    effectiveRelevance,
    effectiveImpact,
    composite,
    bestSourceTier: input.bestSourceTier,
    tierMultiplier,
  };
}
