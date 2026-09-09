import { createHash } from "node:crypto";

import type {
  AnalysisFolderStatus,
  EnrichmentFactInput,
} from "./analysis-service-types.js";

/** Entrée du calcul d’empreinte d’agrégat (gel 007.1A §12). */
export interface AggregateFingerprintInput {
  readonly folderId: string;
  readonly articleIds: readonly string[];
  readonly enrichmentFacts: readonly EnrichmentFactInput[];
  readonly folderStatus: AnalysisFolderStatus;
}

/**
 * Canonicalisation déterministe V1 (UTF-8).
 *
 * Format figé (tests de régression) :
 * ```
 * folderId=<id>\n
 * articles=<id1>,<id2>,...   // tri lexicographique
 * facts=<key=value\n...>     // paires triées lexicographiquement
 * status=<open|idle|closed>
 * ```
 *
 * Les `proposedFacts` LLM ne sont jamais inclus.
 */
export function canonicalizeAggregateFingerprint(
  input: AggregateFingerprintInput,
): string {
  const folderId = input.folderId.trim();
  const articles = [...input.articleIds]
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join(",");

  const facts = [...input.enrichmentFacts]
    .map((fact) => `${fact.key.trim()}=${fact.value.trim()}`)
    .filter((pair) => pair !== "=")
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join("\n");

  return [
    `folderId=${folderId}`,
    `articles=${articles}`,
    `facts=${facts}`,
    `status=${input.folderStatus}`,
  ].join("\n");
}

/**
 * SHA-256 hex lowercase (64 chars) de la canonicalisation UTF-8.
 */
export function computeAggregateFingerprint(
  input: AggregateFingerprintInput,
): string {
  const canonical = canonicalizeAggregateFingerprint(input);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
