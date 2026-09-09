import type { ProposedFactV1 } from "./analysis-proposal-types.js";
import type { AnalysisWarningCode } from "./analysis-service-types.js";
import { unicodeLength } from "./validate-analysis-proposal.js";

/** Normalisation pour ancrage (minuscules, espaces compressés). */
export function normalizeAnchorText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Tokens alphanumériques significatifs (longueur ≥ 3) — gel 007.1A §8.1.
 */
export function significantTokens(value: string): string[] {
  const matches = normalizeAnchorText(value).match(/[a-z0-9àâäéèêëïîôùûüçœæ]+/gi);
  if (!matches) {
    return [];
  }
  return matches
    .map((token) => token.toLowerCase())
    .filter((token) => unicodeLength(token) >= 3);
}

/**
 * Un fait `explicit` est ancrable ssi :
 * - key/value non vides après trim ; et
 * - value normalisée est sous-chaîne de l’agrégat ou du titre ; ou
 * - chaque token significatif apparaît dans l’agrégat (tolérance d’ordre).
 */
export function isFactAnchored(
  fact: ProposedFactV1,
  aggregateText: string,
  folderTitle: string,
): boolean {
  const key = fact.key.trim();
  const value = fact.value.trim();
  if (key.length === 0 || value.length === 0) {
    return false;
  }

  const haystack = normalizeAnchorText(`${aggregateText}\n${folderTitle}`);
  const needle = normalizeAnchorText(value);

  if (needle.length > 0 && haystack.includes(needle)) {
    return true;
  }

  if (fact.support !== "explicit") {
    return false;
  }

  const tokens = significantTokens(value);
  if (tokens.length === 0) {
    return false;
  }

  return tokens.every((token) => haystack.includes(token));
}

export interface FactValidationInput {
  readonly proposedFacts: readonly ProposedFactV1[];
  readonly aggregateText: string;
  readonly folderTitle: string;
}

export interface FactValidationResult {
  readonly retainedFacts: ProposedFactV1[];
  readonly droppedFacts: ProposedFactV1[];
  readonly warnings: AnalysisWarningCode[];
}

/**
 * Ancrage + déduplication des faits (gel 007.1A §8).
 * - `inferred` → toujours écarté
 * - clé normalisée (minuscule) : première occurrence conservée
 */
export function validateAndAnchorFacts(
  input: FactValidationInput,
): FactValidationResult {
  const droppedFacts: ProposedFactV1[] = [];
  const retainedFacts: ProposedFactV1[] = [];
  const seenKeys = new Set<string>();

  for (const fact of input.proposedFacts) {
    if (fact.support === "inferred") {
      droppedFacts.push(fact);
      continue;
    }

    if (!isFactAnchored(fact, input.aggregateText, input.folderTitle)) {
      droppedFacts.push(fact);
      continue;
    }

    const keyNorm = fact.key.trim().toLowerCase();
    if (seenKeys.has(keyNorm)) {
      droppedFacts.push(fact);
      continue;
    }

    seenKeys.add(keyNorm);
    retainedFacts.push(fact);
  }

  const warnings: AnalysisWarningCode[] = [];
  if (droppedFacts.length > 0) {
    warnings.push("facts_dropped");
  }

  return { retainedFacts, droppedFacts, warnings };
}

export interface EntityDedupResult {
  readonly entities: string[];
  readonly warnings: AnalysisWarningCode[];
}

/**
 * Déduplication case-insensitive des entités (gel 007.1A §7.5).
 * Première occurrence conservée.
 */
export function deduplicateEntities(
  entities: readonly string[],
): EntityDedupResult {
  const result: string[] = [];
  const seen = new Set<string>();
  let deduped = false;

  for (const entity of entities) {
    const key = entity.trim().toLowerCase();
    if (key.length === 0) {
      continue;
    }
    if (seen.has(key)) {
      deduped = true;
      continue;
    }
    seen.add(key);
    result.push(entity.trim());
  }

  return {
    entities: result,
    warnings: deduped ? ["entities_deduplicated"] : [],
  };
}
