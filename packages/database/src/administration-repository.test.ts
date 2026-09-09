import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  createAdminOperationLogRepository,
  createPipelineLockRepository,
} from "./administration-repository.js";
import {
  AdministrationPersistenceError,
  PIPELINE_LOCK_ID,
} from "./administration-types.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(packageRoot, "prisma", "migrations");
const schemaPath = join(packageRoot, "prisma", "schema.prisma");

type RunRow = Record<string, unknown> & { id: string; status: string };
type LockRow = {
  id: string;
  runId: string | null;
  holderId: string | null;
  acquiredAt: Date | null;
  heartbeatAt: Date | null;
  expiresAt: Date | null;
};
type AdminRow = Record<string, unknown> & { id: string };

function createPrismaDouble() {
  const runs = new Map<string, RunRow>();
  let runSeq = 0;
  let adminSeq = 0;
  const admins: AdminRow[] = [];
  let lock: LockRow = {
    id: PIPELINE_LOCK_ID,
    runId: null,
    holderId: null,
    acquiredAt: null,
    heartbeatAt: null,
    expiresAt: null,
  };

  const prisma = {
    $transaction: vi.fn(async (fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    ),
    $queryRaw: vi.fn(async () => [{ ...lock }]),
    pipelineLock: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (where.id !== lock.id) return null;
        return { ...lock };
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<LockRow>;
        }) => {
          if (where.id !== lock.id) {
            throw new Error("lock not found");
          }
          lock = { ...lock, ...data };
          return { ...lock };
        },
      ),
    },
    pipelineRun: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        runSeq += 1;
        const row: RunRow = {
          id: `run_${runSeq}`,
          summary: null,
          errorMessage: null,
          finishedAt: null,
          createdAt: (data.startedAt as Date) ?? new Date(),
          updatedAt: (data.startedAt as Date) ?? new Date(),
          ...data,
        };
        runs.set(row.id, row);
        return { ...row };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = runs.get(where.id);
        return row === undefined ? null : { ...row };
      }),
      findFirst: vi.fn(async () => {
        const ordered = [...runs.values()].sort(
          (a, b) =>
            (b.startedAt as Date).getTime() - (a.startedAt as Date).getTime(),
        );
        return ordered[0] === undefined ? null : { ...ordered[0] };
      }),
      findMany: vi.fn(
        async ({
          where,
          take,
        }: {
          where?: { status?: string };
          take?: number;
        }) => {
          let list = [...runs.values()];
          if (where?.status !== undefined) {
            list = list.filter((r) => r.status === where.status);
          }
          list.sort(
            (a, b) =>
              (b.startedAt as Date).getTime() -
              (a.startedAt as Date).getTime(),
          );
          return list.slice(0, take ?? 50).map((r) => ({ ...r }));
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const existing = runs.get(where.id);
          if (existing === undefined) {
            throw new Error("run not found");
          }
          const next = {
            ...existing,
            ...data,
            updatedAt: new Date(),
          };
          // Prisma.DbNull sentinel handling in tests: treat as null
          if (
            data.summary !== undefined &&
            data.summary !== null &&
            typeof data.summary === "object" &&
            "name" in (data.summary as object)
          ) {
            next.summary = null;
          }
          runs.set(where.id, next);
          return { ...next };
        },
      ),
    },
    adminOperationLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        adminSeq += 1;
        const row: AdminRow = {
          id: `admin_${adminSeq}`,
          createdAt: (data.requestedAt as Date) ?? new Date(),
          ...data,
        };
        admins.push(row);
        return { ...row };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return admins.find((a) => a.id === where.id) ?? null;
      }),
      findMany: vi.fn(
        async ({
          where,
          take,
        }: {
          where?: {
            actorId?: string;
            kind?: string;
            outcome?: string;
          };
          take?: number;
        }) => {
          let list = [...admins];
          if (where?.actorId !== undefined) {
            list = list.filter((a) => a.actorId === where.actorId);
          }
          if (where?.kind !== undefined) {
            list = list.filter((a) => a.kind === where.kind);
          }
          if (where?.outcome !== undefined) {
            list = list.filter((a) => a.outcome === where.outcome);
          }
          list.sort(
            (a, b) =>
              (b.requestedAt as Date).getTime() -
              (a.requestedAt as Date).getTime(),
          );
          return list.slice(0, take ?? 50).map((a) => ({ ...a }));
        },
      ),
      update: vi.fn(async () => {
        throw new Error("AdminOperationLog must remain append-only");
      }),
    },
  };

  return { prisma, runs, getLock: () => lock, setLock: (next: LockRow) => {
    lock = next;
  }, admins };
}

describe("Prisma migration 009.1B", () => {
  it("ships schema models for run / lock / audit / source backoff", () => {
    const schema = readFileSync(schemaPath, "utf8");
    expect(schema).toContain("model PipelineRun");
    expect(schema).toContain("model PipelineLock");
    expect(schema).toContain("model AdminOperationLog");
    expect(schema).toContain("consecutiveFailures");
    expect(schema).toContain("nextEligibleAt");
    expect(schema).toContain("enum PipelineRunStatus");
    expect(schema).toContain("enum AdminOperationKind");
  });

  it("ships a PostgreSQL migration for administration persistence", () => {
    expect(existsSync(join(migrationsDir, "migration_lock.toml"))).toBe(true);

    const entries = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const migrationName = entries.find((name) =>
      name.includes("administration_persistence"),
    );
    expect(migrationName).toBeDefined();

    const sql = readFileSync(
      join(migrationsDir, migrationName!, "migration.sql"),
      "utf8",
    );

    expect(sql).toContain('CREATE TABLE "PipelineRun"');
    expect(sql).toContain('CREATE TABLE "PipelineLock"');
    expect(sql).toContain('CREATE TABLE "AdminOperationLog"');
    expect(sql).toContain('"consecutiveFailures"');
    expect(sql).toContain('"nextEligibleAt"');
    expect(sql).toContain("INSERT INTO \"PipelineLock\"");
    expect(sql).toContain("'global'");
  });
});

describe("createPipelineLockRepository", () => {
  it("acquires the singleton lock and creates a running PipelineRun", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createPipelineLockRepository(prisma as never);
    const now = new Date("2026-07-16T22:00:00.000Z");
    const expiresAt = new Date("2026-07-16T22:05:00.000Z");

    const outcome = await repo.tryAcquire({
      holderId: "worker-1",
      trigger: "scheduled",
      expiresAt,
      now,
    });

    expect(outcome.kind).toBe("acquired");
    if (outcome.kind !== "acquired") return;
    expect(outcome.stolen).toBe(false);
    expect(outcome.run.status).toBe("running");
    expect(outcome.run.holderId).toBe("worker-1");
    expect(outcome.lock.id).toBe(PIPELINE_LOCK_ID);
    expect(outcome.lock.runId).toBe(outcome.run.id);
    expect(outcome.lock.expiresAt).toEqual(expiresAt);
  });

  it("blocks a second acquire while the lock is fresh (single-flight)", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createPipelineLockRepository(prisma as never);
    const now = new Date("2026-07-16T22:00:00.000Z");
    const expiresAt = new Date("2026-07-16T22:05:00.000Z");

    const first = await repo.tryAcquire({
      holderId: "worker-1",
      trigger: "cli",
      expiresAt,
      now,
    });
    expect(first.kind).toBe("acquired");

    const second = await repo.tryAcquire({
      holderId: "worker-2",
      trigger: "manual",
      expiresAt: new Date("2026-07-16T22:10:00.000Z"),
      now: new Date("2026-07-16T22:01:00.000Z"),
    });

    expect(second.kind).toBe("blocked");
    if (second.kind !== "blocked") return;
    expect(second.lock.holderId).toBe("worker-1");
    expect(second.run?.id).toBe(
      first.kind === "acquired" ? first.run.id : undefined,
    );
  });

  it("steals an expired lock and marks the previous run failed", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createPipelineLockRepository(prisma as never);

    const first = await repo.tryAcquire({
      holderId: "worker-1",
      trigger: "scheduled",
      expiresAt: new Date("2026-07-16T22:05:00.000Z"),
      now: new Date("2026-07-16T22:00:00.000Z"),
    });
    expect(first.kind).toBe("acquired");
    if (first.kind !== "acquired") return;

    const stolen = await repo.tryAcquire({
      holderId: "worker-2",
      trigger: "manual",
      expiresAt: new Date("2026-07-16T22:15:00.000Z"),
      now: new Date("2026-07-16T22:06:00.000Z"),
    });

    expect(stolen.kind).toBe("acquired");
    if (stolen.kind !== "acquired") return;
    expect(stolen.stolen).toBe(true);
    expect(stolen.previousRunId).toBe(first.run.id);
    expect(stolen.lock.holderId).toBe("worker-2");

    const previous = await repo.getRunById(first.run.id);
    expect(previous?.status).toBe("failed");
    expect(previous?.errorMessage).toContain("expired");
  });

  it("heartbeats and releases the lock with a terminal run status", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createPipelineLockRepository(prisma as never);
    const now = new Date("2026-07-16T22:00:00.000Z");

    const acquired = await repo.tryAcquire({
      holderId: "worker-1",
      trigger: "scheduled",
      expiresAt: new Date("2026-07-16T22:05:00.000Z"),
      now,
    });
    expect(acquired.kind).toBe("acquired");
    if (acquired.kind !== "acquired") return;

    const hb = await repo.heartbeat({
      holderId: "worker-1",
      expiresAt: new Date("2026-07-16T22:08:00.000Z"),
      now: new Date("2026-07-16T22:02:00.000Z"),
    });
    expect(hb.expiresAt).toEqual(new Date("2026-07-16T22:08:00.000Z"));

    const released = await repo.release({
      holderId: "worker-1",
      status: "completed",
      summary: { sourcesOk: 3, articlesCreated: 12 },
      now: new Date("2026-07-16T22:03:00.000Z"),
    });

    expect(released.run.status).toBe("completed");
    expect(released.run.summary).toEqual({
      sourcesOk: 3,
      articlesCreated: 12,
    });
    expect(released.lock.runId).toBeNull();
    expect(released.lock.holderId).toBeNull();

    const after = await repo.tryAcquire({
      holderId: "worker-1",
      trigger: "cli",
      expiresAt: new Date("2026-07-16T22:20:00.000Z"),
      now: new Date("2026-07-16T22:04:00.000Z"),
    });
    expect(after.kind).toBe("acquired");
  });

  it("rejects heartbeat / release from a non-holder", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createPipelineLockRepository(prisma as never);

    await repo.tryAcquire({
      holderId: "worker-1",
      trigger: "manual",
      expiresAt: new Date("2026-07-16T22:05:00.000Z"),
      now: new Date("2026-07-16T22:00:00.000Z"),
    });

    await expect(
      repo.heartbeat({
        holderId: "intruder",
        expiresAt: new Date("2026-07-16T22:10:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(AdministrationPersistenceError);

    await expect(
      repo.release({
        holderId: "intruder",
        status: "failed",
      }),
    ).rejects.toMatchObject({ code: "lock_holder_mismatch" });
  });

  it("lists runs newest first and returns the latest run", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createPipelineLockRepository(prisma as never);

    const a = await repo.tryAcquire({
      holderId: "w",
      trigger: "cli",
      expiresAt: new Date("2026-07-16T22:05:00.000Z"),
      now: new Date("2026-07-16T21:00:00.000Z"),
    });
    expect(a.kind).toBe("acquired");
    if (a.kind !== "acquired") return;
    await repo.release({
      holderId: "w",
      status: "completed",
      now: new Date("2026-07-16T21:01:00.000Z"),
    });

    const b = await repo.tryAcquire({
      holderId: "w",
      trigger: "scheduled",
      expiresAt: new Date("2026-07-16T22:15:00.000Z"),
      now: new Date("2026-07-16T22:00:00.000Z"),
    });
    expect(b.kind).toBe("acquired");
    if (b.kind !== "acquired") return;

    const latest = await repo.getLatestRun();
    expect(latest?.id).toBe(b.run.id);

    const listed = await repo.listRuns({ limit: 10 });
    expect(listed.map((r) => r.id)).toEqual([b.run.id, a.run.id]);
  });
});

describe("createAdminOperationLogRepository", () => {
  it("appends admin operations and never updates", async () => {
    const { prisma, admins } = createPrismaDouble();
    const lockRepo = createPipelineLockRepository(prisma as never);
    const adminRepo = createAdminOperationLogRepository(prisma as never);

    const acquired = await lockRepo.tryAcquire({
      holderId: "worker-1",
      trigger: "manual",
      expiresAt: new Date("2026-07-16T22:05:00.000Z"),
      now: new Date("2026-07-16T22:00:00.000Z"),
    });
    expect(acquired.kind).toBe("acquired");
    if (acquired.kind !== "acquired") return;

    const first = await adminRepo.recordOperation({
      actorId: "123456789012345678",
      kind: "force_reanalysis",
      target: { folderId: "folder_1" },
      outcome: "succeeded",
      pipelineRunId: acquired.run.id,
      detail: "forceReanalysis accepted",
      requestedAt: new Date("2026-07-16T22:01:00.000Z"),
    });

    const second = await adminRepo.recordOperation({
      actorId: "cli",
      kind: "clear_source_backoff",
      target: { sourceId: "openai-blog" },
      outcome: "accepted",
      requestedAt: new Date("2026-07-16T22:02:00.000Z"),
    });

    expect(admins).toHaveLength(2);
    expect(first.kind).toBe("force_reanalysis");
    expect(first.pipelineRunId).toBe(acquired.run.id);
    expect(second.actorId).toBe("cli");
    expect(prisma.adminOperationLog.create).toHaveBeenCalledTimes(2);
    expect(prisma.adminOperationLog.update).not.toHaveBeenCalled();

    const listed = await adminRepo.listOperations({ limit: 10 });
    expect(listed.map((o) => o.id)).toEqual([second.id, first.id]);

    const byActor = await adminRepo.listOperations({
      actorId: "cli",
    });
    expect(byActor).toHaveLength(1);
    expect(byActor[0]?.kind).toBe("clear_source_backoff");
  });

  it("rejects recording against a missing pipeline run", async () => {
    const { prisma } = createPrismaDouble();
    const adminRepo = createAdminOperationLogRepository(prisma as never);

    await expect(
      adminRepo.recordOperation({
        actorId: "admin",
        kind: "run_cycle",
        target: {},
        outcome: "accepted",
        pipelineRunId: "missing-run",
      }),
    ).rejects.toMatchObject({ code: "run_absent" });
  });
});
