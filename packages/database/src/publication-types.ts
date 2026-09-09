import type {
  PublicationAttemptStatus,
  PublicationErrorCode,
  PublicationOperationKind,
  PublicationStatus,
} from "@prisma/client";

export type {
  PublicationAttemptStatus,
  PublicationErrorCode,
  PublicationOperationKind,
  PublicationStatus,
};

/** Stable business error codes for publication persistence (008.1B). */
export type PublicationPersistenceErrorCode =
  | "folder_absent"
  | "folder_closed"
  | "main_already_reserved_or_exists"
  | "enrichment_precondition_failed"
  | "inconsistent_state"
  | "invalid_idempotency_key"
  | "forbidden_status_transition";

/**
 * Raised when a publication persistence command violates gel 008.1A invariants
 * (missing/closed folder, illegal transition, bad idempotency key, etc.).
 */
export class PublicationPersistenceError extends Error {
  readonly code: PublicationPersistenceErrorCode;

  constructor(code: PublicationPersistenceErrorCode, message: string) {
    super(message);
    this.name = "PublicationPersistenceError";
    this.code = code;
  }
}

/** Current publication state for a folder (mutable). */
export interface FolderPublicationRecord {
  id: string;
  folderId: string;
  status: PublicationStatus;
  guildId: string;
  channelId: string | null;
  mainMessageId: string | null;
  threadId: string | null;
  sourceAnalysisAttemptId: string | null;
  lastErrorCode: PublicationErrorCode | null;
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
  /**
   * Derived (gel 008.1A §3.2): mainMessageId != null &&
   * status ∈ { partial, main_published, inconsistent }.
   */
  hasMainPublication: boolean;
}

/** Append-only publication attempt record. */
export interface PublicationAttemptRecord {
  id: string;
  folderPublicationId: string;
  folderId: string;
  kind: PublicationOperationKind;
  attemptNumber: number;
  idempotencyKey: string;
  analysisAttemptId: string | null;
  eventFingerprint: string | null;
  status: PublicationAttemptStatus;
  discordMessageId: string | null;
  discordThreadId: string | null;
  errorCode: PublicationErrorCode | null;
  retryable: boolean;
  nextAttemptAt: Date | null;
  durationMs: number | null;
  /** Active Discord execution lease holder (010.1A AUD-002). */
  executionHolderId: string | null;
  executionLeaseExpiresAt: Date | null;
  attemptedAt: Date;
  createdAt: Date;
}

/** Create or load the current FolderPublication row for a folder. */
export interface GetOrCreateFolderPublicationInput {
  folderId: string;
  guildId: string;
}

/** Reserve a publish (main) operation — gel 008.1A §6.1 / §9. */
export interface ReservePublishInput {
  folderId: string;
  guildId: string;
  analysisAttemptId?: string | null;
  /** Defaults to `publish:{folderId}`. */
  idempotencyKey?: string;
}

/** Reserve a non-publish operation (create_thread / enrich / unarchive / reconcile). */
export interface ReservePublicationOperationInput {
  folderId: string;
  kind: Exclude<PublicationOperationKind, "publish">;
  idempotencyKey: string;
  analysisAttemptId?: string | null;
  eventFingerprint?: string | null;
  /** Defaults to 1; must be > 0. */
  attemptNumber?: number;
}

export type ReservePublicationOutcome =
  | {
      readonly kind: "reserved";
      readonly publication: FolderPublicationRecord;
      readonly attempt: PublicationAttemptRecord;
    }
  | {
      readonly kind: "idempotent_hit";
      readonly publication: FolderPublicationRecord;
      readonly attempt: PublicationAttemptRecord;
      readonly reason: "already_published" | "already_reserved" | "already_succeeded";
    };

/** Persist main message + optional thread after Discord success. */
export interface RecordMainPublicationSuccessInput {
  folderId: string;
  channelId: string;
  guildId: string;
  mainMessageId: string;
  /** When set → status main_published; when null → partial. */
  threadId?: string | null;
  analysisAttemptId?: string | null;
  /** Attempt to mark succeeded (idempotency key or id). */
  attemptId?: string;
  idempotencyKey?: string;
  durationMs?: number | null;
}

/** Persist thread id after create_thread recovery (partial → main_published). */
export interface RecordThreadCreatedInput {
  folderId: string;
  threadId: string;
  attemptId?: string;
  idempotencyKey?: string;
  durationMs?: number | null;
}

/** Persist enrichment message success in the thread. */
export interface RecordEnrichmentPublishedInput {
  folderId: string;
  discordMessageId: string;
  attemptId?: string;
  idempotencyKey?: string;
  durationMs?: number | null;
}

/** Record a normalized failure on an attempt (+ optional FolderPublication status). */
export interface RecordPublicationFailureInput {
  folderId: string;
  attemptId?: string;
  idempotencyKey?: string;
  errorCode: PublicationErrorCode;
  retryable: boolean;
  nextAttemptAt?: Date | null;
  durationMs?: number | null;
  /**
   * When true (default for kind=publish failures without IDs), set FolderPublication
   * status to `failed`. Partial with mainMessageId stays `partial`.
   */
  markFolderFailed?: boolean;
}

export interface ListPublicationAttemptsOptions {
  /** Default `"desc"` (newest first). */
  order?: "asc" | "desc";
  kind?: PublicationOperationKind;
  status?: PublicationAttemptStatus;
}

export interface ListRetryablePublicationOptions {
  /** Only attempts with nextAttemptAt <= asOf (default now). */
  asOf?: Date;
  /** Max rows (default 100). */
  take?: number;
}

export const PUBLICATION_ERROR_CODES = [
  "folder_closed",
  "precondition_failed",
  "channel_unmapped",
  "channel_unavailable",
  "missing_permission",
  "discord_rate_limited",
  "discord_timeout",
  "discord_unavailable",
  "persist_failed",
  "inconsistent_state",
  "idempotent_hit",
  "hold",
  "reject_editorial",
  "unknown",
] as const satisfies readonly PublicationErrorCode[];

export const PUBLICATION_STATUSES = [
  "none",
  "pending",
  "partial",
  "main_published",
  "failed",
  "inconsistent",
] as const satisfies readonly PublicationStatus[];

/** Allowed FolderPublication status transitions (gel 008.1A §3.1). */
export const PUBLICATION_STATUS_TRANSITIONS: Readonly<
  Record<PublicationStatus, readonly PublicationStatus[]>
> = {
  none: ["pending"],
  pending: ["main_published", "partial", "failed"],
  partial: ["main_published", "inconsistent"],
  main_published: ["inconsistent"],
  failed: ["pending"],
  inconsistent: [],
};

export function computeHasMainPublication(
  status: PublicationStatus,
  mainMessageId: string | null,
): boolean {
  return (
    mainMessageId !== null &&
    (status === "partial" ||
      status === "main_published" ||
      status === "inconsistent")
  );
}

export function buildPublishIdempotencyKey(folderId: string): string {
  return `publish:${folderId}`;
}

export function buildCreateThreadIdempotencyKey(
  folderId: string,
  mainMessageId: string,
): string {
  return `create_thread:${folderId}:${mainMessageId}`;
}

export function buildEnrichIdempotencyKey(
  folderId: string,
  aggregateFingerprint: string,
  analysisAttemptId: string,
): string {
  return `enrich:${folderId}:${aggregateFingerprint}:${analysisAttemptId}`;
}

export function buildUnarchiveIdempotencyKey(
  folderId: string,
  threadId: string,
): string {
  return `unarchive:${folderId}:${threadId}`;
}
