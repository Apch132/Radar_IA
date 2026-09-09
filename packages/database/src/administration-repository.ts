import { Prisma, type PrismaClient } from "@prisma/client";

import {
  AdministrationPersistenceError,
  PIPELINE_LOCK_ID,
  type AcquirePipelineLockInput,
  type AcquirePipelineLockOutcome,
  type AdminOperationLogRecord,
  type HeartbeatPipelineLockInput,
  type ListAdminOperationsOptions,
  type ListPipelineRunsOptions,
  type PipelineLockRecord,
  type PipelineRunRecord,
  type PipelineRunStatus,
  type RecordAdminOperationInput,
  type ReleasePipelineLockInput,
} from "./administration-types.js";

export interface PipelineLockRepository {
  /** Read the singleton lock row (creates nothing — migration seeds it). */
  getLock(): Promise<PipelineLockRecord>;

  /**
   * Acquire single-flight lock and create a `running` PipelineRun.
   * Steals the lock when the current holder's `expiresAt` is past `now`.
   */
  tryAcquire(input: AcquirePipelineLockInput): Promise<AcquirePipelineLockOutcome>;

  /** Refresh heartbeat / expiry while holding the lock. */
  heartbeat(input: HeartbeatPipelineLockInput): Promise<PipelineLockRecord>;

  /**
   * Release the lock and finalize the associated run
   * (`completed` | `failed` | `degraded`).
   */
  release(input: ReleasePipelineLockInput): Promise<{
    lock: PipelineLockRecord;
    run: PipelineRunRecord;
  }>;

  getRunById(id: string): Promise<PipelineRunRecord | null>;

  getLatestRun(): Promise<PipelineRunRecord | null>;

  listRuns(options?: ListPipelineRunsOptions): Promise<PipelineRunRecord[]>;
}

export interface AdminOperationLogRepository {
  /** Append-only insert of an administrative operation. */
  recordOperation(
    input: RecordAdminOperationInput,
  ): Promise<AdminOperationLogRecord>;

  getOperationById(id: string): Promise<AdminOperationLogRecord | null>;

  /** Newest first (`requestedAt` desc, then `createdAt` / `id` desc). */
  listOperations(
    options?: ListAdminOperationsOptions,
  ): Promise<AdminOperationLogRecord[]>;
}

type PipelineRunRow = {
  id: string;
  status: PipelineRunStatus;
  trigger: PipelineRunRecord["trigger"];
  holderId: string;
  startedAt: Date;
  finishedAt: Date | null;
  heartbeatAt: Date;
  summary: Prisma.JsonValue | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type PipelineLockRow = {
  id: string;
  runId: string | null;
  holderId: string | null;
  acquiredAt: Date | null;
  heartbeatAt: Date | null;
  expiresAt: Date | null;
};

type AdminOperationLogRow = {
  id: string;
  actorId: string;
  kind: AdminOperationLogRecord["kind"];
  target: Prisma.JsonValue;
  outcome: AdminOperationLogRecord["outcome"];
  detail: string | null;
  pipelineRunId: string | null;
  requestedAt: Date;
  createdAt: Date;
};

function mapRun(row: PipelineRunRow): PipelineRunRecord {
  return {
    id: row.id,
    status: row.status,
    trigger: row.trigger,
    holderId: row.holderId,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    heartbeatAt: row.heartbeatAt,
    summary: row.summary,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapLock(row: PipelineLockRow): PipelineLockRecord {
  return {
    id: row.id,
    runId: row.runId,
    holderId: row.holderId,
    acquiredAt: row.acquiredAt,
    heartbeatAt: row.heartbeatAt,
    expiresAt: row.expiresAt,
  };
}

function mapAdminOp(row: AdminOperationLogRow): AdminOperationLogRecord {
  return {
    id: row.id,
    actorId: row.actorId,
    kind: row.kind,
    target: row.target,
    outcome: row.outcome,
    detail: row.detail,
    pipelineRunId: row.pipelineRunId,
    requestedAt: row.requestedAt,
    createdAt: row.createdAt,
  };
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AdministrationPersistenceError(
      "invalid_input",
      `${field} must be a non-empty string`,
    );
  }
}

function isLockHeld(lock: PipelineLockRow): boolean {
  return lock.runId !== null && lock.holderId !== null;
}

function isLockExpired(lock: PipelineLockRow, now: Date): boolean {
  if (!isLockHeld(lock)) {
    return false;
  }
  if (lock.expiresAt === null) {
    // Held without expiry is treated as stealable (corrupt / legacy).
    return true;
  }
  return lock.expiresAt.getTime() <= now.getTime();
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function selectPipelineLockForUpdate(
  tx: Prisma.TransactionClient,
): Promise<PipelineLockRow | null> {
  const rows = await tx.$queryRaw<PipelineLockRow[]>(
    Prisma.sql`SELECT "id", "runId", "holderId", "acquiredAt", "heartbeatAt", "expiresAt"
      FROM "PipelineLock" WHERE "id" = ${PIPELINE_LOCK_ID} FOR UPDATE`,
  );
  return rows[0] ?? null;
}

/**
 * Factory for the pipeline single-flight lock + run repository.
 * Prisma client is injected for testability.
 */
export function createPipelineLockRepository(
  prisma: PrismaClient,
): PipelineLockRepository {
  return {
    async getLock() {
      const row = await prisma.pipelineLock.findUnique({
        where: { id: PIPELINE_LOCK_ID },
      });
      if (row === null) {
        throw new AdministrationPersistenceError(
          "invalid_input",
          `PipelineLock singleton "${PIPELINE_LOCK_ID}" is missing — run migrations`,
        );
      }
      return mapLock(row);
    },

    async tryAcquire(input) {
      assertNonEmpty(input.holderId, "holderId");
      const now = input.now ?? new Date();

      return prisma.$transaction(async (tx) => {
        const lock = await selectPipelineLockForUpdate(tx);
        if (lock === null) {
          throw new AdministrationPersistenceError(
            "invalid_input",
            `PipelineLock singleton "${PIPELINE_LOCK_ID}" is missing — run migrations`,
          );
        }

        let stolen = false;
        let previousRunId: string | null = null;

        if (isLockHeld(lock) && !isLockExpired(lock, now)) {
          const blockingRun =
            lock.runId === null
              ? null
              : await tx.pipelineRun.findUnique({ where: { id: lock.runId } });
          return {
            kind: "blocked" as const,
            lock: mapLock(lock),
            run: blockingRun === null ? null : mapRun(blockingRun),
          };
        }

        if (isLockHeld(lock) && isLockExpired(lock, now)) {
          stolen = true;
          previousRunId = lock.runId;
          if (lock.runId !== null) {
            const stale = await tx.pipelineRun.findUnique({
              where: { id: lock.runId },
            });
            if (stale !== null && stale.status === "running") {
              await tx.pipelineRun.update({
                where: { id: lock.runId },
                data: {
                  status: "failed",
                  finishedAt: now,
                  errorMessage: "single-flight lock expired (stolen)",
                  heartbeatAt: now,
                },
              });
            }
          }
        }

        const run = await tx.pipelineRun.create({
          data: {
            status: "running",
            trigger: input.trigger,
            holderId: input.holderId,
            startedAt: now,
            heartbeatAt: now,
          },
        });

        const nextLock = await tx.pipelineLock.update({
          where: { id: PIPELINE_LOCK_ID },
          data: {
            runId: run.id,
            holderId: input.holderId,
            acquiredAt: now,
            heartbeatAt: now,
            expiresAt: input.expiresAt,
          },
        });

        return {
          kind: "acquired" as const,
          lock: mapLock(nextLock),
          run: mapRun(run),
          stolen,
          previousRunId,
        };
      });
    },

    async heartbeat(input) {
      assertNonEmpty(input.holderId, "holderId");
      const now = input.now ?? new Date();

      return prisma.$transaction(async (tx) => {
        const lock = await selectPipelineLockForUpdate(tx);
        if (lock === null || !isLockHeld(lock)) {
          throw new AdministrationPersistenceError(
            "lock_not_held",
            "Cannot heartbeat: pipeline lock is not held",
          );
        }
        if (lock.holderId !== input.holderId) {
          throw new AdministrationPersistenceError(
            "lock_holder_mismatch",
            `Cannot heartbeat: holder mismatch (expected ${String(lock.holderId)})`,
          );
        }
        if (lock.runId === null) {
          throw new AdministrationPersistenceError(
            "run_absent",
            "Cannot heartbeat: lock has no associated run",
          );
        }

        const run = await tx.pipelineRun.findUnique({
          where: { id: lock.runId },
        });
        if (run === null) {
          throw new AdministrationPersistenceError(
            "run_absent",
            `PipelineRun ${lock.runId} not found`,
          );
        }
        if (run.status !== "running") {
          throw new AdministrationPersistenceError(
            "run_not_running",
            `Cannot heartbeat: run status is ${run.status}`,
          );
        }

        await tx.pipelineRun.update({
          where: { id: run.id },
          data: { heartbeatAt: now },
        });

        const nextLock = await tx.pipelineLock.update({
          where: { id: PIPELINE_LOCK_ID },
          data: {
            heartbeatAt: now,
            expiresAt: input.expiresAt,
          },
        });

        return mapLock(nextLock);
      });
    },

    async release(input) {
      assertNonEmpty(input.holderId, "holderId");
      const now = input.now ?? new Date();
      const finishedAt = input.finishedAt ?? now;

      return prisma.$transaction(async (tx) => {
        const lock = await selectPipelineLockForUpdate(tx);
        if (lock === null || !isLockHeld(lock) || lock.runId === null) {
          throw new AdministrationPersistenceError(
            "lock_not_held",
            "Cannot release: pipeline lock is not held",
          );
        }
        if (lock.holderId !== input.holderId) {
          throw new AdministrationPersistenceError(
            "lock_holder_mismatch",
            `Cannot release: holder mismatch (expected ${String(lock.holderId)})`,
          );
        }

        const run = await tx.pipelineRun.findUnique({
          where: { id: lock.runId },
        });
        if (run === null) {
          throw new AdministrationPersistenceError(
            "run_absent",
            `PipelineRun ${lock.runId} not found`,
          );
        }
        if (run.status !== "running") {
          throw new AdministrationPersistenceError(
            "forbidden_run_transition",
            `Cannot release: run status is ${run.status}`,
          );
        }

        const nextRun = await tx.pipelineRun.update({
          where: { id: run.id },
          data: {
            status: input.status,
            finishedAt,
            heartbeatAt: now,
            summary:
              input.summary === undefined
                ? undefined
                : input.summary === null
                  ? Prisma.DbNull
                  : toJsonInput(input.summary),
            errorMessage:
              input.errorMessage === undefined
                ? undefined
                : input.errorMessage,
          },
        });

        const nextLock = await tx.pipelineLock.update({
          where: { id: PIPELINE_LOCK_ID },
          data: {
            runId: null,
            holderId: null,
            acquiredAt: null,
            heartbeatAt: null,
            expiresAt: null,
          },
        });

        return {
          lock: mapLock(nextLock),
          run: mapRun(nextRun),
        };
      });
    },

    async getRunById(id) {
      assertNonEmpty(id, "id");
      const row = await prisma.pipelineRun.findUnique({ where: { id } });
      return row === null ? null : mapRun(row);
    },

    async getLatestRun() {
      const row = await prisma.pipelineRun.findFirst({
        orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      });
      return row === null ? null : mapRun(row);
    },

    async listRuns(options = {}) {
      const limit = options.limit ?? 50;
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new AdministrationPersistenceError(
          "invalid_input",
          `limit must be a positive integer; got ${String(limit)}`,
        );
      }
      const rows = await prisma.pipelineRun.findMany({
        where: options.status === undefined ? undefined : { status: options.status },
        orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        take: limit,
      });
      return rows.map(mapRun);
    },
  };
}

/**
 * Factory for the append-only admin operation audit repository.
 */
export function createAdminOperationLogRepository(
  prisma: PrismaClient,
): AdminOperationLogRepository {
  return {
    async recordOperation(input) {
      assertNonEmpty(input.actorId, "actorId");
      if (input.target === undefined) {
        throw new AdministrationPersistenceError(
          "invalid_input",
          "target is required",
        );
      }

      if (input.pipelineRunId !== undefined && input.pipelineRunId !== null) {
        assertNonEmpty(input.pipelineRunId, "pipelineRunId");
        const run = await prisma.pipelineRun.findUnique({
          where: { id: input.pipelineRunId },
        });
        if (run === null) {
          throw new AdministrationPersistenceError(
            "run_absent",
            `PipelineRun ${input.pipelineRunId} not found`,
          );
        }
      }

      const row = await prisma.adminOperationLog.create({
        data: {
          actorId: input.actorId,
          kind: input.kind,
          target: toJsonInput(input.target),
          outcome: input.outcome,
          detail: input.detail ?? null,
          pipelineRunId: input.pipelineRunId ?? null,
          requestedAt: input.requestedAt ?? new Date(),
        },
      });
      return mapAdminOp(row);
    },

    async getOperationById(id) {
      assertNonEmpty(id, "id");
      const row = await prisma.adminOperationLog.findUnique({ where: { id } });
      return row === null ? null : mapAdminOp(row);
    },

    async listOperations(options = {}) {
      const limit = options.limit ?? 50;
      if (!Number.isInteger(limit) || limit <= 0) {
        throw new AdministrationPersistenceError(
          "invalid_input",
          `limit must be a positive integer; got ${String(limit)}`,
        );
      }
      const rows = await prisma.adminOperationLog.findMany({
        where: {
          actorId: options.actorId,
          kind: options.kind,
          outcome: options.outcome,
        },
        orderBy: [
          { requestedAt: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
        take: limit,
      });
      return rows.map(mapAdminOp);
    },
  };
}
