import { isTierStrictlyHigher } from "./analysis-scoring.js";
import type {
  AnalyzeFolderInput,
  MatchingTriggerIssue,
  SourceTier,
} from "./analysis-service-types.js";

/** Types d’enrichissement matériels (gel 007.1A §11.2). */
export const MATERIAL_ENRICHMENT_TYPES = [
  "correction",
  "denial",
  "availability",
  "update",
  "launch",
] as const;

export type MaterialEnrichmentType = (typeof MATERIAL_ENRICHMENT_TYPES)[number];

export type EligibilityOutcome =
  | { readonly eligible: true; readonly materialEnrichReanalysis: boolean }
  | {
      readonly eligible: false;
      readonly reason: "not_eligible" | "enrichment_immaterial";
    };

function isMaterialEnrichmentType(
  value: string | null | undefined,
): value is MaterialEnrichmentType {
  if (!value) return false;
  return (MATERIAL_ENRICHMENT_TYPES as readonly string[]).includes(value);
}

function normalizeFactKey(key: string): string {
  return key.trim().toLowerCase();
}

/**
 * Réanalyse matérielle (gel 007.1A §11.2) — au moins une condition :
 * 1. enrichmentType ∈ {correction, denial, availability, update, launch}
 * 2. nouvelle clé de fait 006 absente de l’agrégat précédent
 * 3. meilleur tier strictement supérieur à la dernière analyse acceptée
 */
export function isMaterialEnrichment(input: {
  readonly triggerEnrichmentType?: string | null;
  readonly enrichmentFacts: readonly { key: string }[];
  readonly previousEnrichmentFactKeys?: readonly string[];
  readonly bestSourceTier: SourceTier;
  readonly lastAcceptedBestSourceTier?: SourceTier | null;
}): boolean {
  if (isMaterialEnrichmentType(input.triggerEnrichmentType)) {
    return true;
  }

  const previousKeys = new Set(
    (input.previousEnrichmentFactKeys ?? []).map(normalizeFactKey),
  );
  for (const fact of input.enrichmentFacts) {
    const key = normalizeFactKey(fact.key);
    if (key.length > 0 && !previousKeys.has(key)) {
      return true;
    }
  }

  if (
    input.lastAcceptedBestSourceTier &&
    isTierStrictlyHigher(
      input.bestSourceTier,
      input.lastAcceptedBestSourceTier,
    )
  ) {
    return true;
  }

  return false;
}

/**
 * Éligibilité à l’inférence (gel 007.1A §11.1–§11.2).
 * L’idempotence fingerprint est gérée séparément par le service.
 */
export function evaluateEligibility(
  input: AnalyzeFolderInput,
  bestSourceTier: SourceTier,
): EligibilityOutcome {
  if (input.folder.status === "closed") {
    return { eligible: false, reason: "not_eligible" };
  }

  const issue: MatchingTriggerIssue = input.triggerIssue;

  if (issue === "duplicate_editorial" || issue === "ambiguous_no_action") {
    return { eligible: false, reason: "not_eligible" };
  }

  if (issue === "create_dossier") {
    return { eligible: true, materialEnrichReanalysis: false };
  }

  // attach_enrich
  const material = isMaterialEnrichment({
    triggerEnrichmentType: input.triggerEnrichmentType,
    enrichmentFacts: input.enrichmentFacts,
    previousEnrichmentFactKeys: input.previousEnrichmentFactKeys,
    bestSourceTier,
    lastAcceptedBestSourceTier:
      input.lastAcceptedAnalysis?.bestSourceTier ?? null,
  });

  if (!material) {
    return { eligible: false, reason: "enrichment_immaterial" };
  }

  return { eligible: true, materialEnrichReanalysis: true };
}
