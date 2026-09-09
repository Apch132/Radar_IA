import type {
  AnalysisErrorCode,
  AnalysisValidationStatus,
  AnalysisWarningCode,
  PublicationDecision,
} from "@prisma/client";

export type {
  AnalysisErrorCode,
  AnalysisValidationStatus,
  AnalysisWarningCode,
  PublicationDecision,
};

/** Categories figées gel 007.1A §4.1. */
export type AnalysisCategory =
  | "model_release"
  | "product_update"
  | "research"
  | "benchmark"
  | "funding_or_corp"
  | "policy_or_safety"
  | "open_source"
  | "other";

/** Aligné 006 / gel 007.1A §4.2. */
export type AnnouncementNature =
  | "launch"
  | "update"
  | "acquisition"
  | "paper"
  | "denial"
  | "availability"
  | "correction"
  | "other";

/** Gel 007.1A §4.3. */
export type ChannelRoleHint =
  | "annonces_majeures"
  | "veille_pertinente"
  | "flux_ia"
  | "none";

/** Gel 007.1A §4.4. */
export type PublishWorthiness = "high" | "medium" | "low" | "none";

/** Support d'un ProposedFact (gel 007.1A §3.5). */
export type FactSupport = "explicit" | "inferred";

/** Tiers source pour backendScoring (gel 007.1A §7.3 / §9.1). */
export type SourceTier = "S" | "A" | "B" | "C" | "D" | "E";

/** Fait proposé LLM (contrat AnalysisProposalV1). */
export interface ProposedFactV1 {
  key: string;
  value: string;
  support: FactSupport;
}

/** Proposition LLM parseable — gel 007.1A §3. */
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

/** Scoring effectif backend — gel 007.1A §7.3. */
export interface BackendScoringV1 {
  effectiveRelevance: number;
  effectiveImpact: number;
  composite: number;
  bestSourceTier: SourceTier;
  tierMultiplier: number;
}

/**
 * Résultat validé (contrat gel 007.1A §7) — forme publique alignée.
 * `proposal` absente uniquement pour échec pré-parse.
 */
export interface ValidatedAnalysisV1 {
  schemaVersion: "1";
  folderId: string;
  analyzedAt: string;
  modelId: string;
  proposalOrigin: "llm" | "llm_analysis" | "deterministic_fallback";
  aggregateFingerprint: string;
  proposal?: AnalysisProposalV1;
  validation: {
    status: AnalysisValidationStatus;
    warnings: AnalysisWarningCode[];
    droppedFacts: ProposedFactV1[];
  };
  backendScoring?: BackendScoringV1;
}

/** Enregistrement persisté d'une tentative d'analyse (append-only). */
export interface AnalysisAttemptRecord {
  id: string;
  folderId: string;
  aggregateFingerprint: string;
  attemptNumber: number;
  analyzedAt: Date;
  modelId: string | null;
  /** `llm` retained for backward compatibility with existing rows. */
  proposalOrigin: "llm" | "llm_analysis" | "deterministic_fallback";
  validationStatus: AnalysisValidationStatus;
  proposal: AnalysisProposalV1 | null;
  backendScoring: BackendScoringV1 | null;
  errorCodes: AnalysisErrorCode[];
  warnings: AnalysisWarningCode[];
  droppedFacts: ProposedFactV1[];
  publicationDecision: PublicationDecision | null;
  createdAt: Date;
}

/** Input de création append-only — le repository ne décide pas métier. */
export interface RecordAnalysisAttemptInput {
  folderId: string;
  aggregateFingerprint: string;
  attemptNumber: number;
  /** Defaults to now. */
  analyzedAt?: Date;
  /** Tag Ollama effectif si un appel a été tenté. */
  modelId?: string | null;
  /** Decision method origin. */
  proposalOrigin?: "llm" | "llm_analysis" | "deterministic_fallback";
  validationStatus: AnalysisValidationStatus;
  /** Obligatoire sauf échec pré-parse (`rejected` + errorCodes). */
  proposal?: AnalysisProposalV1 | null;
  /** Obligatoire pour accepted / accepted_with_warnings ; interdit pour rejected. */
  backendScoring?: BackendScoringV1 | null;
  errorCodes?: readonly AnalysisErrorCode[];
  warnings?: readonly AnalysisWarningCode[];
  droppedFacts?: readonly ProposedFactV1[];
  publicationDecision?: PublicationDecision | null;
  /** Doit être `"1"` si fourni. */
  schemaVersion?: "1";
}

/** Options de listage chronologique. */
export interface ListAnalysisAttemptsOptions {
  /**
   * Ordre sur `analyzedAt` puis `createdAt` / `id`.
   * Défaut : `"desc"` (plus récent → plus ancien).
   */
  order?: "asc" | "desc";
  /** Filtre optionnel sur l'empreinte d'agrégat. */
  aggregateFingerprint?: string;
}

/**
 * Raised when an analysis persistence input violates gel 007.1A invariants
 * or referential integrity (missing folder, duplicate attempt, etc.).
 */
export class AnalysisIntegrityError extends Error {
  readonly code = "ANALYSIS_INTEGRITY";

  constructor(message: string) {
    super(message);
    this.name = "AnalysisIntegrityError";
  }
}

/** SHA-256 hex fingerprint (64 lowercase/uppercase hex chars). */
export const SHA256_HEX_PATTERN = /^[a-fA-F0-9]{64}$/;

export const ANALYSIS_ERROR_CODES = [
  "not_eligible",
  "enrichment_immaterial",
  "queue_timeout",
  "ollama_unavailable",
  "inference_timeout",
  "invalid_json",
  "schema_violation",
  "empty_summary",
  "context_too_large",
  "model_mismatch",
  "analysis_exhausted",
] as const satisfies readonly AnalysisErrorCode[];

export const ANALYSIS_WARNING_CODES = [
  "facts_dropped",
  "entities_deduplicated",
] as const satisfies readonly AnalysisWarningCode[];
