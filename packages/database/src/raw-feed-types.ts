import type { CollectedSourceState, RawFeedSnapshot } from "@prisma/client";

/** Input for appending a raw feed snapshot (no business transforms). */
export interface SaveRawFeedSnapshotInput {
  sourceId: string;
  collectedAt: Date;
  httpStatus: number;
  etag?: string | null;
  lastModified?: string | null;
  finalUrl?: string | null;
  feedFormat?: string | null;
  rawBody: string;
  parseSucceeded: boolean;
  errorMessage?: string | null;
}

/** Input for upserting per-source incremental collection state. */
export interface SaveCollectedSourceStateInput {
  sourceId: string;
  etag?: string | null;
  lastModified?: string | null;
  lastCollectedAt?: Date | null;
  lastSuccessfulAt?: Date | null;
  lastHttpStatus?: number | null;
  /**
   * Optional backoff fields (009.1B). When omitted on update, existing
   * consecutiveFailures / nextEligibleAt are preserved.
   */
  consecutiveFailures?: number;
  nextEligibleAt?: Date | null;
}

/** Record a collection failure and schedule backoff (009.1B). */
export interface RecordSourceBackoffInput {
  sourceId: string;
  consecutiveFailures: number;
  nextEligibleAt: Date;
  lastCollectedAt?: Date | null;
  lastHttpStatus?: number | null;
}

export type { CollectedSourceState, RawFeedSnapshot };
