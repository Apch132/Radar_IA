/** Categories figées gel 007.1A §4.1. */
export const ANALYSIS_CATEGORIES = [
  "model_release",
  "product_update",
  "research",
  "benchmark",
  "funding_or_corp",
  "policy_or_safety",
  "open_source",
  "other",
] as const;

export type AnalysisCategory = (typeof ANALYSIS_CATEGORIES)[number];

/** Aligné 006 / gel 007.1A §4.2. */
export const ANNOUNCEMENT_NATURES = [
  "launch",
  "update",
  "acquisition",
  "paper",
  "denial",
  "availability",
  "correction",
  "other",
] as const;

export type AnnouncementNature = (typeof ANNOUNCEMENT_NATURES)[number];

/** Gel 007.1A §4.3. */
export const CHANNEL_ROLE_HINTS = [
  "annonces_majeures",
  "veille_pertinente",
  "flux_ia",
  "none",
] as const;

export type ChannelRoleHint = (typeof CHANNEL_ROLE_HINTS)[number];

/** Gel 007.1A §4.4. */
export const PUBLISH_WORTHINESS_VALUES = [
  "high",
  "medium",
  "low",
  "none",
] as const;

export type PublishWorthiness = (typeof PUBLISH_WORTHINESS_VALUES)[number];

/** Support d'un ProposedFact (gel 007.1A §3.5). */
export const FACT_SUPPORT_VALUES = ["explicit", "inferred"] as const;

export type FactSupport = (typeof FACT_SUPPORT_VALUES)[number];

/** Fait proposé LLM (contrat AnalysisProposalV1). */
export interface ProposedFactV1 {
  key: string;
  value: string;
  support: FactSupport;
}

/** Proposition LLM — gel 007.1A §3. */
export interface AnalysisProposalV1 {
  schemaVersion: "1";
  summary: string;
  classification: {
    primaryCategory: AnalysisCategory;
    secondaryCategories: AnalysisCategory[];
    announcementNature: AnnouncementNature;
  };
  scoring: {
    relevance: number;
    impact: number;
    novelty: number;
    confidence: number;
  };
  entities: string[];
  proposedFacts: ProposedFactV1[];
  editorialProposal: {
    publishWorthiness: PublishWorthiness;
    suggestedChannelRole: ChannelRoleHint;
  };
  rationale: string;
}

/**
 * Codes d'erreur remontés par le client / validateur V1 (sous-ensemble gel §14.1).
 * Les codes métier d'orchestration (`not_eligible`, `analysis_exhausted`, …) restent hors 007.1C.
 */
export const ANALYSIS_CLIENT_ERROR_CODES = [
  "invalid_json",
  "schema_violation",
  "empty_summary",
  "inference_timeout",
  "ollama_unavailable",
  "queue_timeout",
] as const;

export type AnalysisClientErrorCode =
  (typeof ANALYSIS_CLIENT_ERROR_CODES)[number];

/** Codes retryables (gel 007.1A §10.3) — tous ceux du client le sont. */
export const RETRYABLE_CLIENT_ERROR_CODES = ANALYSIS_CLIENT_ERROR_CODES;
