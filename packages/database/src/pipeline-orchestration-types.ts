import type { MatchingDecisionIssue } from "@radar-ia/shared";

import type { PipelineRunStatus, PipelineRunTrigger } from "./administration-types.js";
import type { AnalysisOrchestrationResult } from "./analysis-orchestration-types.js";
import type { MatchingOrchestrationResult } from "./matching-orchestration-types.js";
import type { PublicationOrchestrationResult } from "./publication-orchestration-types.js";

/**
 * Progressive source-collection backoff delays (ms) — V1 pipeline defaults.
 * Gel 009.1A leaves numeric thresholds to exploitation; 009.1C ships a
 * documented injectable schedule rather than inventing silent per-call values.
 * Index = consecutiveFailures - 1; last entry caps further failures.
 */
export const SOURCE_BACKOFF_DELAYS_MS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
] as const;

/** Default single-flight lock TTL (ms). */
export const DEFAULT_PIPELINE_LOCK_TTL_MS = 5 * 60_000;

/** Default heartbeat interval while a cycle runs (ms). */
export const DEFAULT_PIPELINE_HEARTBEAT_INTERVAL_MS = 30_000;

export type PipelineSourceOutcome =
  | "collected"
  | "not_modified"
  | "skipped_disabled"
  | "skipped_backoff"
  | "failed";

export type PipelineCycleRejectionCode =
  | "concurrent_lock"
  | "registry_invalid"
  | "persistence_unavailable"
  | "invariant_violated";

export type PipelineNormalizedErrorCode =
  | PipelineCycleRejectionCode
  | "source_collect_failed"
  | "source_persist_failed"
  | "normalize_rejected"
  | "matching_failed"
  | "analysis_failed"
  | "ollama_unavailable"
  | "inference_timeout"
  | "invalid_json"
  | "schema_violation"
  | "empty_summary"
  | "queue_timeout"
  | "model_mismatch"
  | "analysis_exhausted"
  | "context_too_large"
  | "discord_unavailable"
  | "publication_failed"
  | "publication_resume_failed"
  | "heartbeat_failed"
  | "lock_lost"
  | "lock_release_failed"
  | "source_backoff_persist_failed"
  | "raw_feed_purge_failed"
  | "unknown";

/**
 * Bounded, sanitized cycle error — never secrets, Ollama payloads, or stacks.
 */
export interface PipelineNormalizedError {
  readonly code: PipelineNormalizedErrorCode;
  readonly message: string;
  readonly sourceId?: string;
  readonly folderId?: string;
  readonly articleId?: string;
  readonly stage?: string;
  readonly statusCode?: number;
  readonly errorCode?: string;
  readonly retryable?: boolean;
  readonly attemptNumber?: number;
  readonly durationMs?: number;
  readonly model?: string;
}

export interface PipelineSourceCounters {
  readonly total: number;
  readonly enabled: number;
  readonly collected: number;
  readonly notModified: number;
  readonly skippedDisabled: number;
  readonly skippedBackoff: number;
  readonly failed: number;
}

export interface PipelineArticleCounters {
  readonly normalized: number;
  readonly rejected: number;
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
}

export interface PipelineMatchingCounters {
  readonly create_dossier: number;
  readonly attach_enrich: number;
  readonly duplicate_editorial: number;
  readonly ambiguous_no_action: number;
  readonly failed: number;
  readonly skipped: number;
}

export interface PipelineAnalysisCounters {
  readonly analyzed: number;
  readonly reused: number;
  readonly skipped: number;
  readonly failed: number;
}

export interface PipelinePublicationCounters {
  readonly published: number;
  readonly enriched: number;
  readonly resumed: number;
  readonly skipped: number;
  readonly failed: number;
  readonly deferred: number;
}

export interface PipelineCycleResult {
  readonly runId: string | null;
  readonly status: PipelineRunStatus | null;
  readonly trigger: PipelineRunTrigger;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly lockAcquired: boolean;
  readonly lockStolen: boolean;
  readonly rejectionCode: PipelineCycleRejectionCode | null;
  readonly degraded: boolean;
  readonly sources: PipelineSourceCounters;
  readonly articles: PipelineArticleCounters;
  readonly matching: PipelineMatchingCounters;
  readonly analysis: PipelineAnalysisCounters;
  readonly publication: PipelinePublicationCounters;
  readonly errors: readonly PipelineNormalizedError[];
  /** Deterministic summary persisted on PipelineRun when a run existed. */
  readonly summary: PipelineCycleSummary;
}

export interface PipelineCycleSummary {
  readonly version: 1;
  readonly degraded: boolean;
  readonly rejectionCode: PipelineCycleRejectionCode | null;
  readonly sources: PipelineSourceCounters;
  readonly articles: PipelineArticleCounters;
  readonly matching: PipelineMatchingCounters;
  readonly analysis: PipelineAnalysisCounters;
  readonly publication: PipelinePublicationCounters;
  readonly errorCodes: readonly PipelineNormalizedErrorCode[];
}

export interface PipelineCycleInput {
  readonly holderId: string;
  readonly trigger: PipelineRunTrigger;
}

/** Source definition shape accepted by the cycle (compatible with collector). */
export interface PipelineSourceDefinition {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly tier: string;
  readonly enabled: boolean;
  /** Collection provider; defaults to rss when omitted (legacy registries). */
  readonly provider?: string;
}

export interface PipelineSourceRegistry {
  readonly sources: readonly PipelineSourceDefinition[];
}

export interface PipelineSourceFetchState {
  readonly etag?: string;
  readonly lastModified?: string;
}

export interface PipelineParsedFeedItem {
  readonly id?: string;
  readonly title?: string;
  readonly link?: string;
  readonly publishedAt?: string;
  readonly updatedAt?: string;
  readonly author?: string;
  readonly summary?: string;
  readonly content?: string;
  readonly categories?: readonly string[];
}

export interface PipelineParsedFeed {
  readonly format: string;
  readonly title?: string;
  readonly items: readonly PipelineParsedFeedItem[];
  readonly rawBody?: string;
}

export type PipelineCollectResult =
  | {
      readonly status: "not-modified";
      readonly source: PipelineSourceDefinition;
      readonly state: PipelineSourceFetchState;
      readonly httpStatus: 304;
    }
  | {
      readonly status: "updated";
      readonly source: PipelineSourceDefinition;
      readonly state: PipelineSourceFetchState;
      readonly httpStatus: number;
      readonly feed: PipelineParsedFeed;
      readonly rawBody: string;
    };

export interface PipelineNormalizedArticleInput {
  readonly sourceId: string;
  readonly sourceTier: string;
  readonly externalId?: string;
  readonly title: string;
  readonly url: string;
  readonly publishedAt?: string;
  readonly updatedAt?: string;
  readonly author?: string;
  readonly summary?: string;
  readonly content?: string;
  readonly categories: readonly string[];
  readonly feedFormat: string;
}

export interface PipelineRejectedArticle {
  readonly reason: string;
  readonly category?: string;
}

export interface PipelineNormalizeFeedResult {
  readonly articles: readonly PipelineNormalizedArticleInput[];
  readonly rejected: readonly PipelineRejectedArticle[];
}

export interface PipelineSourceRegistryLoader {
  load(): Promise<PipelineSourceRegistry>;
}

export interface PipelineIncrementalCollector {
  collect(
    source: PipelineSourceDefinition,
    state?: PipelineSourceFetchState,
  ): Promise<PipelineCollectResult>;
}

export interface PipelineArticleNormalizer {
  normalizeFeedArticles(
    source: PipelineSourceDefinition,
    feed: PipelineParsedFeed,
  ): PipelineNormalizeFeedResult;
}

export interface PipelineMatchingPort {
  process(input: {
    articleId: string;
    article: {
      sourceId: string;
      sourceTier: string;
      externalId?: string;
      title: string;
      url: string;
      publishedAt?: string;
      summary?: string;
      content?: string;
      categories: readonly string[];
    };
    candidateFolders: readonly import("@radar-ia/shared").MatchingCandidateFolder[];
    decidedAt?: Date;
  }): Promise<MatchingOrchestrationResult>;
}

export interface PipelineAnalysisPort {
  process(
    input: import("./analysis-orchestration-types.js").AnalysisOrchestrationInput,
  ): Promise<AnalysisOrchestrationResult>;
}

export interface PipelinePublicationPort {
  process(
    input: import("./publication-orchestration-types.js").PublicationOrchestrationInput,
  ): Promise<PublicationOrchestrationResult>;
  resume(folderId: string): Promise<PublicationOrchestrationResult>;
}

export interface PipelineClock {
  now(): Date;
}

export interface PipelineLogger {
  warn(message: string, detail?: Record<string, unknown>): void;
  info?(message: string, detail?: Record<string, unknown>): void;
}

export type PipelineMatchingIssue = MatchingDecisionIssue;

/**
 * Raised for wiring / invariant violations in the cycle layer
 * (not local per-source business failures).
 */
export class PipelineOrchestrationError extends Error {
  readonly code = "PIPELINE_ORCHESTRATION";

  constructor(message: string) {
    super(message);
    this.name = "PipelineOrchestrationError";
  }
}

export function computeSourceBackoffDelayMs(
  consecutiveFailures: number,
  schedule: readonly number[] = SOURCE_BACKOFF_DELAYS_MS,
): number {
  if (!Number.isInteger(consecutiveFailures) || consecutiveFailures < 1) {
    throw new PipelineOrchestrationError(
      "consecutiveFailures must be an integer >= 1",
    );
  }
  if (schedule.length === 0) {
    throw new PipelineOrchestrationError("backoff schedule must not be empty");
  }
  const index = Math.min(consecutiveFailures - 1, schedule.length - 1);
  return schedule[index]!;
}

export function computeNextEligibleAt(
  consecutiveFailures: number,
  now: Date,
  schedule: readonly number[] = SOURCE_BACKOFF_DELAYS_MS,
): Date {
  return new Date(
    now.getTime() + computeSourceBackoffDelayMs(consecutiveFailures, schedule),
  );
}

/** Sanitize free-text for run summary / public errors (no secrets / stacks). */
export function sanitizePipelineMessage(
  message: string,
  maxLength = 240,
): string {
  const collapsed = message.replace(/\s+/g, " ").trim();
  const redacted = collapsed
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]")
    .replace(/postgresql?:\/\/\S+/gi, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "[redacted]")
    .replace(/DISCORD_TOKEN\s*=\s*\S+/gi, "[redacted]")
    .replace(/DATABASE_URL\s*=\s*\S+/gi, "[redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");
  if (redacted.length <= maxLength) {
    return redacted;
  }
  return `${redacted.slice(0, maxLength - 1)}…`;
}
