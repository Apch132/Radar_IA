import { describe, expect, it, vi } from "vitest";

import { createAdminOpsService } from "./admin-ops-service.js";

function createPrismaDouble(overrides: Record<string, unknown> = {}) {
  let inferenceLock = {
    id: "ollama",
    holderId: null as string | null,
    acquiredAt: null as Date | null,
    expiresAt: null as Date | null,
    heartbeatAt: null as Date | null,
  };

  const prisma = {
    $transaction: vi.fn(async (fn: (tx: typeof prisma) => Promise<unknown>) =>
      fn(prisma),
    ),
    $queryRaw: vi.fn(async () => [{ ...inferenceLock }]),
    folderPublication: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
    },
    analysisAttempt: {
      findMany: vi.fn(async () => []),
    },
    matchingDecision: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
    },
    newsFolder: {
      count: vi.fn(async () => 0),
      findMany: vi.fn(async () => []),
    },
    collectedSourceState: {
      findMany: vi.fn(async () => []),
    },
    inferenceLock: {
      findUnique: vi.fn(async () => ({ ...inferenceLock })),
      update: vi.fn(
        async ({ data }: { data: Partial<typeof inferenceLock> }) => {
          inferenceLock = { ...inferenceLock, ...data };
          return { ...inferenceLock };
        },
      ),
    },
    pipelineLock: {
      findUnique: vi.fn(async () => ({
        id: "global",
        runId: null,
        holderId: null,
        acquiredAt: null,
        heartbeatAt: null,
        expiresAt: null,
      })),
    },
    pipelineRun: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "run_1"
          ? {
              id: "run_1",
              status: "completed",
              trigger: "manual",
              holderId: "bot:host:1:abc",
              startedAt: new Date(),
              finishedAt: new Date(),
              heartbeatAt: new Date(),
              summary: null,
              errorMessage: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            }
          : null,
      ),
    },
    adminOperationLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "audit_1",
        actorId: data.actorId,
        kind: data.kind,
        target: data.target,
        outcome: data.outcome,
        detail: data.detail ?? null,
        pipelineRunId: data.pipelineRunId ?? null,
        requestedAt: data.requestedAt ?? new Date(),
        createdAt: new Date(),
      })),
      findUnique: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    ...overrides,
  };

  return prisma;
}

describe("createAdminOpsService", () => {
  it("rejects force reanalysis without confirm and audits", async () => {
    const prisma = createPrismaDouble();
    const ops = createAdminOpsService(prisma as never, {
      analysisOrchestrator: {
        process: vi.fn(),
      },
    });

    const result = await ops.forceReanalysis(
      { actorId: "111111111111111111" },
      { folderId: "folder_1", confirm: false },
    );

    expect(result.outcome).toBe("rejected");
    expect(result.detail).toContain("confirmation");
    expect(prisma.adminOperationLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          kind: "force_reanalysis",
          outcome: "rejected",
        }),
      }),
    );
  });

  it("runs manual cycle via pipeline orchestrator and audits", async () => {
    const prisma = createPrismaDouble();
    const runCycle = vi.fn(async () => ({
      runId: "run_1",
      status: "completed",
      trigger: "manual",
      startedAt: new Date(),
      finishedAt: new Date(),
      lockAcquired: true,
      lockStolen: false,
      rejectionCode: null,
      degraded: false,
      sources: {
        total: 1,
        enabled: 1,
        collected: 1,
        notModified: 0,
        skippedDisabled: 0,
        skippedBackoff: 0,
        failed: 0,
      },
      articles: {
        normalized: 1,
        rejected: 0,
        created: 1,
        updated: 0,
        unchanged: 0,
      },
      matching: {
        create_dossier: 1,
        attach_enrich: 0,
        duplicate_editorial: 0,
        ambiguous_no_action: 0,
        failed: 0,
        skipped: 0,
      },
      analysis: { analyzed: 1, reused: 0, skipped: 0, failed: 0 },
      publication: {
        published: 1,
        enriched: 0,
        resumed: 0,
        skipped: 0,
        failed: 0,
        deferred: 0,
      },
      errors: [],
      summary: {
        version: 1,
        degraded: false,
        rejectionCode: null,
        sources: {
          total: 1,
          enabled: 1,
          collected: 1,
          notModified: 0,
          skippedDisabled: 0,
          skippedBackoff: 0,
          failed: 0,
        },
        articles: {
          normalized: 1,
          rejected: 0,
          created: 1,
          updated: 0,
          unchanged: 0,
        },
        matching: {
          create_dossier: 1,
          attach_enrich: 0,
          duplicate_editorial: 0,
          ambiguous_no_action: 0,
          failed: 0,
          skipped: 0,
        },
        analysis: { analyzed: 1, reused: 0, skipped: 0, failed: 0 },
        publication: {
          published: 1,
          enriched: 0,
          resumed: 0,
          skipped: 0,
          failed: 0,
          deferred: 0,
        },
        errorCodes: [],
      },
    }));

    const ops = createAdminOpsService(prisma as never, {
      pipelineOrchestrator: { runCycle },
    });

    const result = await ops.runCycle(
      { actorId: "111111111111111111" },
      { holderId: "bot:host:1:abc" },
    );

    expect(runCycle).toHaveBeenCalledWith({
      holderId: "bot:host:1:abc",
      trigger: "manual",
    });
    expect(result.outcome).toBe("succeeded");
    expect(result.cycle.runId).toBe("run_1");
    expect(prisma.adminOperationLog.create).toHaveBeenCalled();
  });

  it("lists interventions from publication / analysis / matching queues", async () => {
    const prisma = createPrismaDouble({
      folderPublication: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => [
          {
            folderId: "f1",
            status: "inconsistent",
            lastErrorCode: "inconsistent_state",
            updatedAt: new Date("2026-07-16T10:00:00Z"),
          },
        ]),
      },
      analysisAttempt: {
        findMany: vi.fn(async () => [
          {
            folderId: "f2",
            analyzedAt: new Date("2026-07-16T11:00:00Z"),
            publicationDecision: "hold",
          },
        ]),
      },
      matchingDecision: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => [
          {
            folderId: null,
            articleId: "a1",
            decidedAt: new Date("2026-07-16T09:00:00Z"),
          },
        ]),
      },
      newsFolder: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
      },
    });

    const ops = createAdminOpsService(prisma as never);
    const items = await ops.listInterventions({ limit: 10 });

    expect(items.map((i) => i.reason)).toEqual([
      "analysis_exhausted",
      "publication_inconsistent",
      "ambiguous_no_action",
    ]);
  });

  it("does not leak secrets in force reanalysis failure detail", async () => {
    const prisma = createPrismaDouble();
    const ops = createAdminOpsService(prisma as never, {
      analysisOrchestrator: {
        process: vi.fn(async () => {
          throw new Error(
            "boom postgresql://radar:super-secret@localhost:5432/radar_ia",
          );
        }),
      },
      publicationOrchestrator: undefined,
    });

    // Bypass getPublicationByFolder by stubbing through a custom publications path:
    // createAdminOpsService builds its own repo — force failure before that by
    // making process throw after we inject a lock-only path. Use confirm + mock
    // prisma folderPublication findUnique via repository is hard; call with
    // analysis that throws after getPublication — repository uses prisma.
    prisma.folderPublication = {
      ...prisma.folderPublication,
      findUnique: vi.fn(async () => null),
    };

    const result = await ops.forceReanalysis(
      { actorId: "111111111111111111" },
      { folderId: "folder_x", confirm: true },
    );

    expect(result.outcome).toBe("failed");
    expect(result.detail).not.toContain("super-secret");
    expect(result.detail).toContain("[redacted]");
  });
});
