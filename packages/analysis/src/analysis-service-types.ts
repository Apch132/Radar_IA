import type {
  AnalysisProposalV1,
  ProposedFactV1,
} from "./analysis-proposal-types.js";

/** Tiers source (gel 007.1A §9.1). */
export type SourceTier = "S" | "A" | "B" | "C" | "D" | "E";

/** Statut dossier 006. */
export type AnalysisFolderStatus = "open" | "idle" | "closed";

/** Issues 006 déclenchantes (gel 007.1A §11.1). */
export type MatchingTriggerIssue =
  | "create_dossier"
  | "attach_enrich"
  | "duplicate_editorial"
  | "ambiguous_no_action";

/** Statuts de validation (gel 007.1A §4.5). */
export type AnalysisValidationStatus =
  | "accepted"
  | "accepted_with_warnings"
  | "rejected";

/** Warnings V1 (gel 007.1A §14.2). */
export type AnalysisWarningCode = "facts_dropped" | "entities_deduplicated";

/** Codes d’erreur V1 (gel 007.1A §14.1). */
export type AnalysisErrorCode =
  | "not_eligible"
  | "enrichment_immaterial"
  | "queue_timeout"
  | "ollama_unavailable"
  | "inference_timeout"
  | "invalid_json"
  | "schema_violation"
  | "empty_summary"
  | "context_too_large"
  | "model_mismatch"
  | "analysis_exhausted";

/** Décisions de publication backend (gel 007.1A §4.7). */
export type PublicationDecision =
  | "publish"
  | "enrich_thread_only"
  | "hold"
  | "reject_editorial";

/** Scoring effectif backend — gel 007.1A §7.3. */
export interface BackendScoringV1 {
  effectiveRelevance: number;
  effectiveImpact: number;
  composite: number;
  bestSourceTier: SourceTier;
  tierMultiplier: number;
}

/** Résultat validé — gel 007.1A §7. */
export interface ValidatedAnalysisV1 {
  schemaVersion: "1";
  folderId: string;
  analyzedAt: string;
  modelId: string;
  /** `llm` retained for backward compatibility; prefer `llm_analysis`. */
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

/** Fait d’enrichissement 006 retenu. */
export interface EnrichmentFactInput {
  readonly key: string;
  readonly value: string;
}

/** Article rattaché au dossier pour le contexte d’analyse. */
export interface AnalysisArticleInput {
  readonly articleId: string;
  readonly role: "primary" | "enrichment";
  /** Stable registry source id when known (fallback / observability). */
  readonly sourceId?: string;
  readonly sourceTier: SourceTier;
  readonly title: string;
  readonly url: string;
  readonly summary?: string | null;
  readonly content?: string | null;
  /** Horodatage de rattachement (ordre de réduction enrichissements). */
  readonly attachedAt: string | Date;
  /** Type d’enrichissement 006 si rôle enrichment. */
  readonly enrichmentType?: string | null;
}

/** Dossier courant (métadonnées minimales). */
export interface AnalysisFolderInput {
  readonly id: string;
  readonly status: AnalysisFolderStatus;
  readonly title: string;
}

/**
 * Dernière analyse acceptée utile pour idempotence / réanalyse matérielle.
 * Fournie par l’appelant ou reconstruite via la persistence injectée.
 */
export interface LastAcceptedAnalysisHint {
  readonly attemptId: string;
  readonly aggregateFingerprint: string;
  readonly bestSourceTier: SourceTier;
  readonly publicationDecision: PublicationDecision | null;
  readonly analyzedAt: string;
  readonly validationStatus: AnalysisValidationStatus;
  readonly proposal?: AnalysisProposalV1;
  readonly backendScoring?: BackendScoringV1;
  readonly warnings?: readonly AnalysisWarningCode[];
  readonly droppedFacts?: readonly ProposedFactV1[];
  readonly modelId?: string;
}

/** Entrée structurée du service d’analyse (gel 007.1A + prompt 007.1D). */
export interface AnalyzeFolderInput {
  readonly folderId: string;
  readonly folder: AnalysisFolderInput;
  readonly articles: readonly AnalysisArticleInput[];
  /** Faits d’enrichissement 006 retenus (agrégat). */
  readonly enrichmentFacts: readonly EnrichmentFactInput[];
  /** Issue 006 déclenchante. */
  readonly triggerIssue: MatchingTriggerIssue;
  /**
   * Type d’enrichissement de l’article qui a déclenché `attach_enrich`
   * (si applicable).
   */
  readonly triggerEnrichmentType?: string | null;
  /** Publication Discord principale déjà présente (V1 : flag métier). */
  readonly hasMainPublication: boolean;
  /**
   * Clés de faits présentes dans l’agrégat précédent (réanalyse matérielle).
   * Si omis, dérivées de `previousEnrichmentFactKeys` via persistence / hint.
   */
  readonly previousEnrichmentFactKeys?: readonly string[];
  /** Dernière analyse acceptée connue (idempotence / tier). */
  readonly lastAcceptedAnalysis?: LastAcceptedAnalysisHint | null;
  /** Invalidation admin / 009 uniquement (hors automation V1). */
  readonly forceReanalysis?: boolean;
  /**
   * Empreinte pré-calculée (optionnelle). Si absente, calculée par le service.
   */
  readonly aggregateFingerprint?: string;
}

/** Hint salon backend (gel 007.1A §9.8) — pas de donnée Discord. */
export type ChannelSalonHint =
  | "annonces_majeures"
  | "veille_pertinente"
  | "flux_ia"
  | "none";

export type AnalysisServiceResult =
  | {
      readonly kind: "created";
      readonly attemptId: string;
      readonly folderId: string;
      readonly aggregateFingerprint: string;
      readonly decision: PublicationDecision;
      readonly analysis: ValidatedAnalysisV1;
      readonly channelHint: ChannelSalonHint;
      readonly attemptNumber: number;
      readonly decisionMethod: "llm_analysis" | "deterministic_fallback";
    }
  | {
      readonly kind: "reused";
      readonly attemptId: string;
      readonly folderId: string;
      readonly aggregateFingerprint: string;
      readonly decision: PublicationDecision | null;
      readonly analysis: ValidatedAnalysisV1;
      readonly channelHint: ChannelSalonHint | null;
      readonly decisionMethod: "llm_analysis" | "deterministic_fallback";
    }
  | {
      readonly kind: "skipped";
      readonly attemptId: string;
      readonly folderId: string;
      readonly aggregateFingerprint: string;
      readonly reason: "not_eligible" | "enrichment_immaterial";
      readonly attemptNumber: number;
    }
  | {
      readonly kind: "failed";
      readonly attemptId: string;
      readonly folderId: string;
      readonly aggregateFingerprint: string;
      readonly decision: "hold";
      readonly errorCodes: readonly AnalysisErrorCode[];
      readonly analysis: ValidatedAnalysisV1;
      readonly attemptNumber: number;
      readonly failureDetail?: AnalysisFailureDetail;
    };

/** Structured failure detail for observability (never includes secrets). */
export interface AnalysisFailureDetail {
  readonly stage:
    | "request"
    | "transport"
    | "timeout"
    | "http"
    | "parse"
    | "schema_validation"
    | "persistence"
    | "lease";
  readonly errorCode: string;
  readonly message: string;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly attemptNumber: number;
  readonly durationMs: number;
  readonly model: string;
  readonly ollamaBaseUrl?: string;
}

/**
 * Port de persistence aligné sur `createAnalysisAttemptRepository` (007.1B).
 * Duck-typing : le repository database est injectable directement.
 */
export interface AnalysisAttemptPersistence {
  recordAnalysisAttempt(input: {
    folderId: string;
    aggregateFingerprint: string;
    attemptNumber: number;
    analyzedAt?: Date;
    modelId?: string | null;
    proposalOrigin?: "llm" | "llm_analysis" | "deterministic_fallback";
    validationStatus: AnalysisValidationStatus;
    proposal?: AnalysisProposalV1 | null;
    backendScoring?: BackendScoringV1 | null;
    errorCodes?: readonly AnalysisErrorCode[];
    warnings?: readonly AnalysisWarningCode[];
    droppedFacts?: readonly ProposedFactV1[];
    publicationDecision?: PublicationDecision | null;
    schemaVersion?: "1";
  }): Promise<{
    id: string;
    folderId: string;
    aggregateFingerprint: string;
    attemptNumber: number;
    analyzedAt: Date;
    modelId: string | null;
    proposalOrigin: "llm" | "llm_analysis" | "deterministic_fallback";
    validationStatus: AnalysisValidationStatus;
    proposal: AnalysisProposalV1 | null;
    backendScoring: BackendScoringV1 | null;
    errorCodes: AnalysisErrorCode[];
    warnings: AnalysisWarningCode[];
    droppedFacts: ProposedFactV1[];
    publicationDecision: PublicationDecision | null;
    createdAt: Date;
  }>;

  getLatestAcceptedAnalysisForFingerprint(
    folderId: string,
    aggregateFingerprint: string,
  ): Promise<{
    id: string;
    folderId: string;
    aggregateFingerprint: string;
    attemptNumber: number;
    analyzedAt: Date;
    modelId: string | null;
    proposalOrigin?: "llm" | "llm_analysis" | "deterministic_fallback";
    validationStatus: AnalysisValidationStatus;
    proposal: AnalysisProposalV1 | null;
    backendScoring: BackendScoringV1 | null;
    warnings: AnalysisWarningCode[];
    droppedFacts: ProposedFactV1[];
    publicationDecision: PublicationDecision | null;
  } | null>;

  countAttemptsForFingerprint(
    folderId: string,
    aggregateFingerprint: string,
  ): Promise<number>;

  countHoldDecisionsForFingerprint(
    folderId: string,
    aggregateFingerprint: string,
  ): Promise<number>;
}

export interface AnalysisServiceClock {
  now(): Date;
}

export interface AnalysisServiceLogger {
  info(message: string, detail?: Record<string, unknown>): void;
  warn(message: string, detail?: Record<string, unknown>): void;
}

export interface CreateAnalysisServiceDependencies {
  readonly ollamaClient: {
    infer(input: {
      prompt: string;
      systemPrompt?: string;
    }): Promise<
      | {
          ok: true;
          proposal: AnalysisProposalV1;
          rawText: string;
          modelId: string;
          attempts: number;
          durationMs?: number;
        }
      | {
          ok: false;
          errorCode:
            | "invalid_json"
            | "schema_violation"
            | "empty_summary"
            | "inference_timeout"
            | "ollama_unavailable"
            | "queue_timeout";
          message: string;
          attempts: number;
          rawText?: string;
          cause?: unknown;
          stage?: AnalysisFailureDetail["stage"];
          statusCode?: number;
          durationMs?: number;
          retryable?: boolean;
          logErrorCode?: string;
        }
    >;
    readonly baseUrl?: string;
    readonly model?: string;
  };
  readonly persistence: AnalysisAttemptPersistence;
  /** Tag modèle attendu (`OLLAMA_MODEL`) pour détecter `model_mismatch`. */
  readonly expectedModelId: string;
  readonly clock?: AnalysisServiceClock;
  readonly logger?: AnalysisServiceLogger;
  /** Optional Ollama base URL for structured failure logs (no secrets). */
  readonly ollamaBaseUrl?: string;
}
