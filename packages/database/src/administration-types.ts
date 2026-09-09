import type {
  AdminOperationKind,
  AdminOperationOutcome,
  PipelineRunStatus,
  PipelineRunTrigger,
} from "@prisma/client";

export type {
  AdminOperationKind,
  AdminOperationOutcome,
  PipelineRunStatus,
  PipelineRunTrigger,
};

/** Singleton lock id for V1 single-flight (gel 009.1A §8). */
export const PIPELINE_LOCK_ID = "global" as const;

/** Stable business error codes for administration persistence (009.1B). */
export type AdministrationPersistenceErrorCode =
  | "lock_held"
  | "lock_not_held"
  | "lock_holder_mismatch"
  | "run_absent"
  | "run_not_running"
  | "forbidden_run_transition"
  | "invalid_input";

/**
 * Raised when an administration persistence command violates 009.1A invariants
 * (single-flight, run lifecycle, input shape).
 */
export class AdministrationPersistenceError extends Error {
  readonly code: AdministrationPersistenceErrorCode;

  constructor(code: AdministrationPersistenceErrorCode, message: string) {
    super(message);
    this.name = "AdministrationPersistenceError";
    this.code = code;
  }
}

/** Current pipeline run record. */
export interface PipelineRunRecord {
  id: string;
  status: PipelineRunStatus;
  trigger: PipelineRunTrigger;
  holderId: string;
  startedAt: Date;
  finishedAt: Date | null;
  heartbeatAt: Date;
  summary: unknown | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Singleton pipeline lock snapshot. */
export interface PipelineLockRecord {
  id: string;
  runId: string | null;
  holderId: string | null;
  acquiredAt: Date | null;
  heartbeatAt: Date | null;
  expiresAt: Date | null;
}

/** Append-only admin operation audit row. */
export interface AdminOperationLogRecord {
  id: string;
  actorId: string;
  kind: AdminOperationKind;
  target: unknown;
  outcome: AdminOperationOutcome;
  detail: string | null;
  pipelineRunId: string | null;
  requestedAt: Date;
  createdAt: Date;
}

/** Acquire single-flight + create a running PipelineRun. */
export interface AcquirePipelineLockInput {
  holderId: string;
  trigger: PipelineRunTrigger;
  /** Absolute expiry for the lock (TTL). Required. */
  expiresAt: Date;
  /**
   * Reference time for stale detection. Defaults to `new Date()`.
   * A held lock with `expiresAt <= now` (or missing expiresAt while held) is stealable.
   */
  now?: Date;
}

export type AcquirePipelineLockOutcome =
  | {
      readonly kind: "acquired";
      readonly lock: PipelineLockRecord;
      readonly run: PipelineRunRecord;
      /** True when a previous stale holder was displaced. */
      readonly stolen: boolean;
      readonly previousRunId: string | null;
    }
  | {
      readonly kind: "blocked";
      readonly lock: PipelineLockRecord;
      readonly run: PipelineRunRecord | null;
    };

/** Heartbeat while holding the lock. */
export interface HeartbeatPipelineLockInput {
  holderId: string;
  /** New absolute expiry. */
  expiresAt: Date;
  now?: Date;
}

/** Release lock and finalize the associated run. */
export interface ReleasePipelineLockInput {
  holderId: string;
  status: Exclude<PipelineRunStatus, "running">;
  summary?: unknown | null;
  errorMessage?: string | null;
  finishedAt?: Date;
  now?: Date;
}

/** List recent pipeline runs. */
export interface ListPipelineRunsOptions {
  limit?: number;
  status?: PipelineRunStatus;
}

/** Append an admin operation audit entry. */
export interface RecordAdminOperationInput {
  actorId: string;
  kind: AdminOperationKind;
  target: unknown;
  outcome: AdminOperationOutcome;
  detail?: string | null;
  pipelineRunId?: string | null;
  requestedAt?: Date;
}

/** List admin operations (newest first). */
export interface ListAdminOperationsOptions {
  limit?: number;
  actorId?: string;
  kind?: AdminOperationKind;
  outcome?: AdminOperationOutcome;
}

/** Closed sets re-exported for callers without Prisma client types. */
export const PIPELINE_RUN_STATUSES = [
  "running",
  "completed",
  "failed",
  "degraded",
] as const satisfies readonly PipelineRunStatus[];

export const PIPELINE_RUN_TRIGGERS = [
  "scheduled",
  "manual",
  "cli",
] as const satisfies readonly PipelineRunTrigger[];

export const ADMIN_OPERATION_KINDS = [
  "run_cycle",
  "collect_source",
  "force_reanalysis",
  "resume_publication",
  "force_retry_publication",
  "reconcile",
  "force_republish",
  "set_folder_status",
  "reconcile_ids",
  "clear_source_backoff",
] as const satisfies readonly AdminOperationKind[];

export const ADMIN_OPERATION_OUTCOMES = [
  "accepted",
  "rejected",
  "succeeded",
  "failed",
  "skipped",
] as const satisfies readonly AdminOperationOutcome[];
