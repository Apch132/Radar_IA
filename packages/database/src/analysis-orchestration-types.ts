import type {
  AnalysisErrorCode,
  AnalysisServiceResult,
  ChannelSalonHint,
  MatchingTriggerIssue,
  PublicationDecision,
  ValidatedAnalysisV1,
} from "@radar-ia/analysis";

import type { MatchingOrchestrationResult } from "./matching-orchestration-types.js";

/**
 * Input for one analysis orchestration pass (007.1E).
 * Prefer identifiers + matching outcome; large objects are loaded from repositories.
 */
export interface AnalysisOrchestrationInput {
  /** Issue 006 déclenchante. */
  matchingIssue: MatchingTriggerIssue;
  /**
   * Dossier cible lorsque 006 en fournit un.
   * Obligatoire pour `create_dossier` / `attach_enrich` (après persistance 006).
   */
  folderId?: string | null;
  /** Article déclencheur (utile pour `attach_enrich` / type d’enrichissement). */
  articleId?: string;
  /**
   * Type d’enrichissement 006 (`attach_enrich`).
   * Si omis, dérivé de l’appartenance de `articleId` dans le dossier.
   */
  triggerEnrichmentType?: string | null;
  /**
   * Faits 006 fournis par la proposition matching (hint optionnel).
   * L’agrégat dossier reste la source de vérité chargée depuis les memberships.
   */
  enrichmentFactsHint?: readonly { key: string; value: string }[] | null;
  /**
   * Publication Discord principale déjà présente.
   * Défaut documenté : `false` tant que le module 008 n’existe pas.
   */
  hasMainPublication?: boolean;
  /** Réanalyse admin / 009 uniquement (propagée à 007.1D). */
  forceReanalysis?: boolean;
}

/** Statuts d’orchestration exposés à l’appelant (mapping 007.1D + skips locaux). */
export type AnalysisOrchestrationStatus =
  | "analyzed"
  | "reused"
  | "skipped"
  | "failed";

/** Codes de skip / erreur au niveau orchestration (hors détail service). */
export type AnalysisOrchestrationSkipCode =
  | "not_eligible"
  | "enrichment_immaterial";

export type AnalysisOrchestrationErrorCode =
  | "folder_not_found"
  | "folder_id_required"
  | "primary_article_missing"
  | "article_data_missing"
  | AnalysisErrorCode;

interface AnalysisOrchestrationResultBase {
  readonly folderId: string | null;
  readonly matchingIssue: MatchingTriggerIssue;
  readonly status: AnalysisOrchestrationStatus;
  readonly attemptId: string | null;
  readonly aggregateFingerprint: string | null;
  readonly publicationDecision: PublicationDecision | null;
  readonly channelHint: ChannelSalonHint | null;
  readonly analysis: ValidatedAnalysisV1 | null;
  readonly skipCode: AnalysisOrchestrationSkipCode | null;
  readonly errorCodes: readonly AnalysisOrchestrationErrorCode[];
  /** Résultat brut 007.1D lorsque le service a été appelé. */
  readonly serviceResult: AnalysisServiceResult | null;
}

export type AnalysisOrchestrationResult = AnalysisOrchestrationResultBase;

/**
 * Raised for contract / wiring violations (not business skip/fail results).
 */
export class AnalysisOrchestrationError extends Error {
  readonly code = "ANALYSIS_ORCHESTRATION";

  constructor(message: string) {
    super(message);
    this.name = "AnalysisOrchestrationError";
  }
}

/**
 * Map a 006 matching orchestration result to a 007 analysis input.
 * Uses the persisted folder id when available.
 */
export function matchingResultToAnalysisInput(
  matching: MatchingOrchestrationResult,
  options: {
    hasMainPublication?: boolean;
    forceReanalysis?: boolean;
  } = {},
): AnalysisOrchestrationInput {
  const folderId =
    matching.persistence.folder?.id ??
    matching.proposal.folderId ??
    matching.persistence.decision.folderId;

  return {
    matchingIssue: matching.proposal.issue,
    folderId,
    articleId: matching.persistence.decision.articleId,
    triggerEnrichmentType: matching.proposal.enrichmentType,
    enrichmentFactsHint: matching.proposal.enrichmentFacts,
    hasMainPublication: options.hasMainPublication,
    forceReanalysis: options.forceReanalysis,
  };
}
