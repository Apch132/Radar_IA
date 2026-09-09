import type { MATCHING_THRESHOLDS } from "./matching-thresholds.js";

/** Source tiers aligned with the official registry (S→E). */
export type MatchingSourceTier = "S" | "A" | "B" | "C" | "D" | "E";

/** Decision issues frozen by gel 006.1A §4. */
export type MatchingDecisionIssue =
  | "create_dossier"
  | "attach_enrich"
  | "duplicate_editorial"
  | "ambiguous_no_action";

/** Qualitative confidence levels frozen by gel 006.1A §5.6. */
export type MatchingConfidence = "high" | "medium" | "low" | "none";

/** Folder lifecycle states frozen by gel 006.1A §7. */
export type MatchingFolderStatus = "open" | "idle" | "closed";

/**
 * Deterministic announcement natures used as matching signals.
 * Lexical extraction only — never LLM.
 */
export type AnnouncementNature =
  | "launch"
  | "update"
  | "acquisition"
  | "paper"
  | "denial"
  | "availability"
  | "correction"
  | "other";

/**
 * Structural article input for matching.
 * Compatible with collector `NormalizedArticle` and persisted 005 rows.
 */
export interface MatchingArticleInput {
  readonly sourceId: string;
  readonly sourceTier: MatchingSourceTier;
  readonly externalId?: string;
  readonly title: string;
  readonly url: string;
  readonly publishedAt?: string;
  readonly summary?: string;
  readonly content?: string;
  readonly categories: readonly string[];
}

/**
 * Aggregated event fingerprint for a candidate folder.
 * Built by the caller (engine never searches candidates).
 */
export interface EventFingerprint {
  readonly entities: readonly string[];
  readonly productOrOrg?: string;
  readonly announcementNature?: AnnouncementNature;
  readonly version?: string;
  /** Normalized fact keys already retained in the dossier. */
  readonly knownFactKeys: readonly string[];
  readonly categories: readonly string[];
  readonly canonicalUrls: readonly string[];
  /** Representative ISO date for temporal proximity. */
  readonly referenceDate?: string;
  readonly bestSourceTier?: MatchingSourceTier;
}

/** One candidate dossier supplied by the caller. */
export interface MatchingCandidateFolder {
  readonly id: string;
  readonly status: MatchingFolderStatus;
  readonly title: string;
  readonly fingerprint: EventFingerprint;
}

/** Structured enrichment fact proposed for attach_enrich. */
export interface MatchingEnrichmentFact {
  readonly key: string;
  readonly value: string;
}

/**
 * Deterministic matching proposal.
 * Persistence (006.1C) remains caller-driven from this result.
 */
export interface MatchingEvaluationResult {
  readonly issue: MatchingDecisionIssue;
  readonly folderId: string | null;
  readonly confidence: MatchingConfidence;
  readonly motiveCodes: readonly string[];
  readonly favorableSignals: readonly string[];
  readonly unfavorableSignals: readonly string[];
  readonly enrichmentFacts: readonly MatchingEnrichmentFact[] | null;
  readonly enrichmentType: string | null;
  /** Suggested title when issue is create_dossier. */
  readonly folderTitle: string | null;
  readonly justification: string;
  readonly proposalOrigin: "rule";
  readonly reevaluable: boolean;
}

export interface MatchingEngineOptions {
  readonly thresholds?: Partial<typeof MATCHING_THRESHOLDS>;
}

export interface MatchingEngine {
  /**
   * Evaluate one article against caller-supplied candidate folders.
   * Pure: no I/O, no mutation, no persistence.
   */
  evaluate(
    article: MatchingArticleInput,
    candidateFolders: readonly MatchingCandidateFolder[],
  ): MatchingEvaluationResult;
}
