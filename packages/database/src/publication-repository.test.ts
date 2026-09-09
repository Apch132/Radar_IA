import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createPublicationRepository } from "./publication-repository.js";
import {
  PublicationPersistenceError,
  PUBLICATION_STATUS_TRANSITIONS,
  buildCreateThreadIdempotencyKey,
  buildEnrichIdempotencyKey,
  buildPublishIdempotencyKey,
  computeHasMainPublication,
} from "./publication-types.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(packageRoot, "prisma", "migrations");
const schemaPath = join(packageRoot, "prisma", "schema.prisma");

const MIGRATION_NAME = "20260716211000_add_folder_publication_data_model";

type FolderSeed = {
  id: string;
  status: "open" | "idle" | "closed";
};

function createPrismaDouble(seedFolders: FolderSeed[] = [{ id: "fld_1", status: "open" }]) {
  const folders = seedFolders.map((f) => ({ ...f }));
  const publications: Array<Record<string, unknown>> = [];
  const attempts: Array<Record<string, unknown>> = [];
  let seq = 0;
  let clock = 0;
  let failNextCreate = false;

  function nextTimestamp(): Date {
    clock += 1;
    return new Date(`2026-07-16T21:${String(clock).padStart(2, "0")}:00.000Z`);
  }

  function nextId(prefix: string): string {
    seq += 1;
    return `${prefix}_${seq}`;
  }

  const newsFolder = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      return folders.find((row) => row.id === where.id) ?? null;
    }),
  };

  const folderPublication = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (failNextCreate) {
        failNextCreate = false;
        throw new Error("Simulated composite write failure");
      }
      const folderExists = folders.some((row) => row.id === data.folderId);
      if (!folderExists) {
        throw new Error("Foreign key constraint violation (folderId)");
      }
      const conflict = publications.find((row) => row.folderId === data.folderId);
      if (conflict !== undefined) {
        throw new Error("Unique constraint violation on folderId");
      }
      const now = nextTimestamp();
      const row = {
        id: nextId("fp"),
        status: "none",
        channelId: null,
        mainMessageId: null,
        threadId: null,
        sourceAnalysisAttemptId: null,
        lastErrorCode: null,
        createdAt: now,
        updatedAt: now,
        lastActivityAt: data.lastActivityAt ?? now,
        ...data,
      };
      publications.push(row);
      return row;
    }),
    findUnique: vi.fn(async ({ where }: { where: { folderId: string } | { id: string } }) => {
      if ("folderId" in where) {
        return publications.find((row) => row.folderId === where.folderId) ?? null;
      }
      return publications.find((row) => row.id === where.id) ?? null;
    }),
    findMany: vi.fn(
      async ({
        where,
        orderBy,
      }: {
        where?: { status?: { in: string[] } };
        orderBy?: Array<Record<string, "asc" | "desc">>;
      }) => {
        let rows = [...publications];
        if (where?.status?.in !== undefined) {
          const allowed = new Set(where.status.in);
          rows = rows.filter((row) => allowed.has(row.status as string));
        }
        if (orderBy !== undefined) {
          for (const clause of [...orderBy].reverse()) {
            const [field, dir] = Object.entries(clause)[0]!;
            rows.sort((a, b) => {
              const av = a[field];
              const bv = b[field];
              const cmp =
                av instanceof Date && bv instanceof Date
                  ? av.getTime() - bv.getTime()
                  : String(av).localeCompare(String(bv));
              return dir === "desc" ? -cmp : cmp;
            });
          }
        }
        return rows;
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
        const row = publications.find((entry) => entry.id === where.id);
        if (row === undefined) {
          throw new Error(`FolderPublication ${where.id} not found`);
        }
        Object.assign(row, data, { updatedAt: nextTimestamp() });
        return row;
      },
    ),
  };

  function activeConflict(idempotencyKey: string): boolean {
    return attempts.some(
      (row) =>
        row.idempotencyKey === idempotencyKey &&
        (row.status === "reserved" || row.status === "succeeded"),
    );
  }

  const publicationAttempt = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (failNextCreate) {
        failNextCreate = false;
        throw new Error("Simulated composite write failure");
      }
      const pubExists = publications.some(
        (row) => row.id === data.folderPublicationId,
      );
      if (!pubExists) {
        throw new Error("Foreign key constraint violation (folderPublicationId)");
      }
      const keyConflict = attempts.find(
        (row) =>
          row.idempotencyKey === data.idempotencyKey &&
          row.attemptNumber === data.attemptNumber,
      );
      if (keyConflict !== undefined) {
        throw new Error("Unique constraint violation on idempotencyKey+attemptNumber");
      }
      if (
        (data.status === "reserved" || data.status === "succeeded") &&
        activeConflict(data.idempotencyKey as string)
      ) {
        throw new Error("Unique constraint violation on active idempotencyKey");
      }
      const now = nextTimestamp();
      const row = {
        id: nextId("pa"),
        analysisAttemptId: null,
        eventFingerprint: null,
        discordMessageId: null,
        discordThreadId: null,
        errorCode: null,
        retryable: false,
        nextAttemptAt: null,
        durationMs: null,
        attemptedAt: data.attemptedAt ?? now,
        createdAt: now,
        ...data,
      };
      attempts.push(row);
      return row;
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      return attempts.find((row) => row.id === where.id) ?? null;
    }),
    findFirst: vi.fn(
      async ({
        where,
        orderBy,
        select,
      }: {
        where: Record<string, unknown>;
        orderBy?: Array<Record<string, "asc" | "desc">>;
        select?: Record<string, boolean>;
      }) => {
        let rows = [...attempts];
        if (typeof where.folderId === "string") {
          rows = rows.filter((row) => row.folderId === where.folderId);
        }
        if (typeof where.idempotencyKey === "string") {
          rows = rows.filter(
            (row) => row.idempotencyKey === where.idempotencyKey,
          );
        }
        if (typeof where.kind === "string") {
          rows = rows.filter((row) => row.kind === where.kind);
        }
        if (typeof where.status === "string") {
          rows = rows.filter((row) => row.status === where.status);
        }
        if (
          where.status !== undefined &&
          typeof where.status === "object" &&
          where.status !== null &&
          "in" in (where.status as object)
        ) {
          const allowed = new Set(
            (where.status as { in: string[] }).in,
          );
          rows = rows.filter((row) => allowed.has(row.status as string));
        }
        if (orderBy !== undefined) {
          for (const clause of [...orderBy].reverse()) {
            const [field, dir] = Object.entries(clause)[0]!;
            rows.sort((a, b) => {
              const av = a[field] as number | Date | string;
              const bv = b[field] as number | Date | string;
              let cmp = 0;
              if (av instanceof Date && bv instanceof Date) {
                cmp = av.getTime() - bv.getTime();
              } else if (typeof av === "number" && typeof bv === "number") {
                cmp = av - bv;
              } else {
                cmp = String(av).localeCompare(String(bv));
              }
              return dir === "desc" ? -cmp : cmp;
            });
          }
        }
        const first = rows[0];
        if (first === undefined) {
          return null;
        }
        if (select !== undefined) {
          const picked: Record<string, unknown> = {};
          for (const key of Object.keys(select)) {
            if (select[key]) {
              picked[key] = first[key];
            }
          }
          return picked;
        }
        return first;
      },
    ),
    findMany: vi.fn(
      async ({
        where,
        orderBy,
        take,
      }: {
        where?: Record<string, unknown>;
        orderBy?: Array<Record<string, "asc" | "desc">>;
        take?: number;
      }) => {
        let rows = [...attempts];
        if (where !== undefined) {
          if (typeof where.folderId === "string") {
            rows = rows.filter((row) => row.folderId === where.folderId);
          }
          if (typeof where.kind === "string") {
            rows = rows.filter((row) => row.kind === where.kind);
          }
          if (typeof where.status === "string") {
            rows = rows.filter((row) => row.status === where.status);
          }
          if (
            where.status !== undefined &&
            typeof where.status === "object" &&
            where.status !== null &&
            "in" in (where.status as object)
          ) {
            const allowed = new Set(
              (where.status as { in: string[] }).in,
            );
            rows = rows.filter((row) => allowed.has(row.status as string));
          }
          if (Array.isArray(where.OR)) {
            rows = rows.filter((row) =>
              (where.OR as Array<Record<string, unknown>>).some((clause) =>
                matchesClause(row, clause),
              ),
            );
          }
        }
        if (orderBy !== undefined) {
          for (const clause of [...orderBy].reverse()) {
            const [field, dir] = Object.entries(clause)[0]!;
            rows.sort((a, b) => {
              const av = a[field];
              const bv = b[field];
              if (av == null && bv == null) return 0;
              if (av == null) return 1;
              if (bv == null) return -1;
              const cmp =
                av instanceof Date && bv instanceof Date
                  ? av.getTime() - bv.getTime()
                  : String(av).localeCompare(String(bv));
              return dir === "desc" ? -cmp : cmp;
            });
          }
        }
        if (take !== undefined) {
          rows = rows.slice(0, take);
        }
        return rows;
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
        const row = attempts.find((entry) => entry.id === where.id);
        if (row === undefined) {
          throw new Error(`PublicationAttempt ${where.id} not found`);
        }
        Object.assign(row, data);
        return row;
      },
    ),
  };

  function matchesClause(
    row: Record<string, unknown>,
    clause: Record<string, unknown>,
  ): boolean {
    if (typeof clause.status === "string" && row.status !== clause.status) {
      return false;
    }
    if (clause.retryable === true && row.retryable !== true) {
      return false;
    }
    if (Array.isArray(clause.OR)) {
      return (clause.OR as Array<Record<string, unknown>>).some((inner) => {
        if (inner.nextAttemptAt === null) {
          return row.nextAttemptAt === null;
        }
        if (
          inner.nextAttemptAt !== undefined &&
          typeof inner.nextAttemptAt === "object" &&
          inner.nextAttemptAt !== null &&
          "lte" in (inner.nextAttemptAt as object)
        ) {
          const lte = (inner.nextAttemptAt as { lte: Date }).lte;
          return (
            row.nextAttemptAt instanceof Date &&
            row.nextAttemptAt.getTime() <= lte.getTime()
          );
        }
        return false;
      });
    }
    return true;
  }

  const prisma = {
    newsFolder,
    folderPublication,
    publicationAttempt,
    $transaction: vi.fn(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
      const snapshotPublications = publications.map((row) => ({ ...row }));
      const snapshotAttempts = attempts.map((row) => ({ ...row }));
      try {
        return await fn(prisma);
      } catch (error) {
        publications.length = 0;
        publications.push(...snapshotPublications);
        attempts.length = 0;
        attempts.push(...snapshotAttempts);
        throw error;
      }
    }),
    __attempts: attempts,
    __publications: publications,
    __failNextCreate: () => {
      failNextCreate = true;
    },
  };

  return prisma;
}

describe("008.1B FolderPublication / PublicationAttempt schema", () => {
  it("1. schema and migration are present", () => {
    const schema = readFileSync(schemaPath, "utf8");
    expect(schema).toContain("model FolderPublication");
    expect(schema).toContain("model PublicationAttempt");
    expect(schema).toContain("enum PublicationStatus");
    expect(schema).toContain("enum PublicationOperationKind");
    expect(schema).toContain("enum PublicationAttemptStatus");
    expect(schema).toContain("enum PublicationErrorCode");

    const migrationPath = join(migrationsDir, MIGRATION_NAME, "migration.sql");
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toContain('CREATE TABLE "FolderPublication"');
    expect(sql).toContain('CREATE TABLE "PublicationAttempt"');
    expect(sql).toContain("PublicationAttempt_idempotencyKey_active_key");
    expect(sql).toContain("ON DELETE RESTRICT");

    const dirs = readdirSync(migrationsDir);
    expect(dirs).toContain(MIGRATION_NAME);
  });
});

describe("createPublicationRepository", () => {
  it("2. creates a FolderPublication", async () => {
    const prisma = createPrismaDouble();
    const repo = createPublicationRepository(prisma as never);
    const pub = await repo.getOrCreateFolderPublication({
      folderId: "fld_1",
      guildId: "111",
    });
    expect(pub.folderId).toBe("fld_1");
    expect(pub.status).toBe("none");
    expect(pub.hasMainPublication).toBe(false);
    expect(pub.guildId).toBe("111");
  });

  it("3. enforces uniqueness of one publication per folder", async () => {
    const prisma = createPrismaDouble();
    const repo = createPublicationRepository(prisma as never);
    const first = await repo.getOrCreateFolderPublication({
      folderId: "fld_1",
      guildId: "111",
    });
    const second = await repo.getOrCreateFolderPublication({
      folderId: "fld_1",
      guildId: "111",
    });
    expect(second.id).toBe(first.id);
    expect(prisma.__publications).toHaveLength(1);
  });

  it("4. atomically reserves a main publish", async () => {
    const prisma = createPrismaDouble();
    const repo = createPublicationRepository(prisma as never);
    const result = await repo.reservePublish({
      folderId: "fld_1",
      guildId: "111",
      analysisAttemptId: null,
    });
    expect(result.kind).toBe("reserved");
    if (result.kind !== "reserved") return;
    expect(result.publication.status).toBe("pending");
    expect(result.attempt.status).toBe("reserved");
    expect(result.attempt.kind).toBe("publish");
    expect(result.attempt.idempotencyKey).toBe(buildPublishIdempotencyKey("fld_1"));
  });

  it("5. second publish reservation is idempotent", async () => {
    const prisma = createPrismaDouble();
    const repo = createPublicationRepository(prisma as never);
    const first = await repo.reservePublish({
      folderId: "fld_1",
      guildId: "111",
    });
    const second = await repo.reservePublish({
      folderId: "fld_1",
      guildId: "111",
    });
    expect(first.kind).toBe("reserved");
    expect(second.kind).toBe("idempotent_hit");
    if (second.kind !== "idempotent_hit") return;
    expect(second.reason).toBe("already_reserved");
    expect(prisma.__attempts.filter((a) => a.kind === "publish")).toHaveLength(1);
  });

  it("6. persists main message + thread", async () => {
    const prisma = createPrismaDouble();
    const repo = createPublicationRepository(prisma as never);
    const reserved = await repo.reservePublish({
      folderId: "fld_1",
      guildId: "111",
    });
    expect(reserved.kind).toBe("reserved");
    if (reserved.kind !== "reserved") return;

    const { publication, attempt } = await repo.recordMainPublicationSuccess({
      folderId: "fld_1",
      guildId: "111",
      channelId: "222",
      mainMessageId: "333",
      threadId: "444",
      attemptId: reserved.attempt.id,
    });
    expect(publication.status).toBe("main_published");
    expect(publication.mainMessageId).toBe("333");
    expect(publication.threadId).toBe("444");
    expect(publication.hasMainPublication).toBe(true);
    expect(attempt?.status).toBe("succeeded");
  });

  it("7. records partial success (message without thread)", async () => {
    const prisma = createPrismaDouble();
    const repo = createPublicationRepository(prisma as never);
    const reserved = await repo.reservePublish({
      folderId: "fld_1",
      guildId: "111",
    });
    if (reserved.kind !== "reserved") return;

    const { publication } = await repo.recordMainPublicationSuccess({
      folderId: "fld_1",
      guildId: "111",
      channelId: "222",
      mainMessageId: "333",
      threadId: null,
      attemptId: reserved.attempt.id,
    });
    expect(publication.status).toBe("partial");
    expect(publication.threadId).toBeNull();
    expect(publication.hasMainPublication).toBe(true);
  });

  it("8. attempts are append-only creates for history", async () => {
    const prisma = createPrismaDouble();
    const repo = createPublicationRepository(prisma as never);
    await repo.reservePublish({ folderId: "fld_1", guildId: "111" });
    await repo.recordFailure({
      folderId: "fld_1",
      idempotencyKey: buildPublishIdempotencyKey("fld_1"),
      errorCode: "discord_timeout",
      retryable: true,
      nextAttemptAt: new Date("2026-07-16T22:00:00.000Z"),
    });
    // After failure, a new reservation can create attemptNumber 2 (append).
    const again = await repo.reservePublish({
      folderId: "fld_1",
      guildId: "111",
    });
    expect(again.kind).toBe("reserved");
    if (again.kind !== "reserved") return;
    expect(again.attempt.attemptNumber).toBe(2);
    expect(prisma.__attempts).toHaveLength(2);
    expect(prisma.__attempts[0]!.attemptNumber).toBe(1);
  });

  it("9. idempotency key uniqueness blocks concurrent active duplicates", async () => {
    const prisma = createPrismaDouble();
    const repo = createPublicationRepository(prisma as never);
    await repo.reservePublish({ folderId: "fld_1", guildId: "111" });
    await expect(
      prisma.publicationAttempt.create({
        data: {
          folderPublicationId: prisma.__publications[0]!.id,
          folderId: "fld_1",
          kind: "publish",
          attemptNumber: 99,
          idempotencyKey: buildPublishIdempotencyKey("fld_1"),
          status: "reserved",
        },
      }),
    ).rejects.toThrow(/active idempotencyKey/);
  });

  it("10. enrichment idempotence by fingerprint key", async () => {
    const prisma = createPrismaDouble();
    const repo = createPublicationRepository(prisma as never);
    const reserved = await repo.reservePublish({
      folderId: "fld_1",
      guildId: "111",
    });
    if (reserved.kind !== "reserved") return;
    await repo.recordMainPublicationSuccess({
      folderId: "fld_1",
      guildId: "111",
      channelId: "222",
      mainMessageId: "333",
      threadId: "444",
      attemptId: reserved.attempt.id,
    });

    const fp =
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const key = buildEnrichIdempotencyKey("fld_1", fp, "aa_1");
    const first = await repo.reserveOperation({
      folderId: "fld_1",
      kind: "enrich",
      idempotencyKey: key,
      eventFingerprint: fp,
      analysisAttemptId: "aa_1",
    });
    expect(first.kind).toBe("reserved");
    const second = await repo.reserveOperation({
      folderId: "fld_1",
      kind: "enrich",
      idempotencyKey: key,
      eventFingerprint: fp,
      analysisAttemptId: "aa_1",
    });
    expect(second.kind).toBe("idempotent_hit");
  });

  it("11. lists chronological attempt history", async () => {
    const prisma = createPrismaDouble();
    const repo = createPublicationRepository(prisma as never);
    await repo.reservePublish({ folderId: "fld_1", guildId: "111" });
    await repo.recordFailure({
      folderId: "fld_1",
      idempotencyKey: buildPublishIdempotencyKey("fld_1"),
      errorCode: "discord_unavailable",
      retryable: true,
    });
    await repo.reservePublish({ folderId: "fld_1", guildId: "111" });

    const asc = await repo.listAttemptsForFolder("fld_1", { order: "asc" });
    expect(asc).toHaveLength(2);
    expect(asc[0]!.attemptNumber).toBe(1);
    expect(asc[1]!.attemptNumber).toBe(2);

    const desc = await repo.listAttemptsForFolder("fld_1", { order: "desc" });
    expect(desc[0]!.attemptNumber).toBe(2);
  });

  it("12. refuses a closed folder", async () => {
    const prisma = createPrismaDouble([{ id: "fld_closed", status: "closed" }]);
    const repo = createPublicationRepository(prisma as never);
    await expect(
      repo.reservePublish({ folderId: "fld_closed", guildId: "111" }),
    ).rejects.toMatchObject({
      name: "PublicationPersistenceError",
      code: "folder_closed",
    });
  });

  it("13. finds retryable attempts", async () => {
    const prisma = createPrismaDouble();
    const repo = createPublicationRepository(prisma as never);
    await repo.reservePublish({ folderId: "fld_1", guildId: "111" });
    await repo.recordFailure({
      folderId: "fld_1",
      idempotencyKey: buildPublishIdempotencyKey("fld_1"),
      errorCode: "discord_rate_limited",
      retryable: true,
      nextAttemptAt: new Date("2026-07-16T20:00:00.000Z"),
    });

    const retryable = await repo.listRetryableAttempts({
      asOf: new Date("2026-07-16T21:00:00.000Z"),
    });
    expect(retryable.length).toBeGreaterThanOrEqual(1);
    expect(retryable[0]!.retryable).toBe(true);
    expect(retryable[0]!.status).toBe("failed");

    const needing = await repo.listPublicationsNeedingResume();
    expect(needing.some((p) => p.status === "failed")).toBe(true);
  });

  it("14. enforces PublicationStatus transition coherence", () => {
    expect(PUBLICATION_STATUS_TRANSITIONS.none).toEqual(["pending"]);
    expect(PUBLICATION_STATUS_TRANSITIONS.pending).toContain("partial");
    expect(PUBLICATION_STATUS_TRANSITIONS.pending).toContain("main_published");
    expect(PUBLICATION_STATUS_TRANSITIONS.pending).toContain("failed");
    expect(PUBLICATION_STATUS_TRANSITIONS.partial).toContain("main_published");
    expect(PUBLICATION_STATUS_TRANSITIONS.main_published).toEqual([
      "inconsistent",
    ]);
    expect(PUBLICATION_STATUS_TRANSITIONS.failed).toEqual(["pending"]);
    expect(PUBLICATION_STATUS_TRANSITIONS.inconsistent).toEqual([]);

    expect(computeHasMainPublication("partial", "m1")).toBe(true);
    expect(computeHasMainPublication("main_published", "m1")).toBe(true);
    expect(computeHasMainPublication("inconsistent", "m1")).toBe(true);
    expect(computeHasMainPublication("pending", "m1")).toBe(false);
    expect(computeHasMainPublication("main_published", null)).toBe(false);
  });

  it("15. has no public delete/update of attempt history API", () => {
    const prisma = createPrismaDouble();
    const repo = createPublicationRepository(prisma as never);
    const keys = Object.keys(repo);
    expect(keys).not.toContain("deleteAttempt");
    expect(keys).not.toContain("updateAttempt");
    expect(keys).not.toContain("deletePublication");
    expect(typeof repo.listAttemptsForFolder).toBe("function");
    expect(typeof repo.recordFailure).toBe("function");
  });

  it("16. rolls back transaction when a composite write fails", async () => {
    const prisma = createPrismaDouble();
    const repo = createPublicationRepository(prisma as never);
    await repo.getOrCreateFolderPublication({
      folderId: "fld_1",
      guildId: "111",
    });
    prisma.__failNextCreate();
    await expect(
      repo.reservePublish({ folderId: "fld_1", guildId: "111" }),
    ).rejects.toThrow(/Simulated composite write failure/);
    expect(prisma.__publications[0]!.status).toBe("none");
    expect(prisma.__attempts).toHaveLength(0);
  });

  it("refuses enrichment without main publication", async () => {
    const prisma = createPrismaDouble();
    const repo = createPublicationRepository(prisma as never);
    await repo.getOrCreateFolderPublication({
      folderId: "fld_1",
      guildId: "111",
    });
    await expect(
      repo.reserveOperation({
        folderId: "fld_1",
        kind: "enrich",
        idempotencyKey: buildEnrichIdempotencyKey("fld_1", "fp", "aa"),
        eventFingerprint: "fp",
      }),
    ).rejects.toBeInstanceOf(PublicationPersistenceError);
  });

  it("completes partial → main_published via recordThreadCreated", async () => {
    const prisma = createPrismaDouble();
    const repo = createPublicationRepository(prisma as never);
    const reserved = await repo.reservePublish({
      folderId: "fld_1",
      guildId: "111",
    });
    if (reserved.kind !== "reserved") return;
    await repo.recordMainPublicationSuccess({
      folderId: "fld_1",
      guildId: "111",
      channelId: "222",
      mainMessageId: "333",
      attemptId: reserved.attempt.id,
    });
    const threadKey = buildCreateThreadIdempotencyKey("fld_1", "333");
    const threadReserve = await repo.reserveOperation({
      folderId: "fld_1",
      kind: "create_thread",
      idempotencyKey: threadKey,
    });
    expect(threadReserve.kind).toBe("reserved");
    if (threadReserve.kind !== "reserved") return;
    const { publication } = await repo.recordThreadCreated({
      folderId: "fld_1",
      threadId: "444",
      attemptId: threadReserve.attempt.id,
    });
    expect(publication.status).toBe("main_published");
    expect(publication.threadId).toBe("444");
  });

  it("finds attempt by idempotency key", async () => {
    const prisma = createPrismaDouble();
    const repo = createPublicationRepository(prisma as never);
    await repo.reservePublish({ folderId: "fld_1", guildId: "111" });
    const key = buildPublishIdempotencyKey("fld_1");
    const found = await repo.findAttemptByIdempotencyKey(key);
    expect(found?.idempotencyKey).toBe(key);
    const active = await repo.findActiveAttemptByIdempotencyKey(key);
    expect(active?.status).toBe("reserved");
  });

  it("refuses absent folder", async () => {
    const prisma = createPrismaDouble();
    const repo = createPublicationRepository(prisma as never);
    await expect(
      repo.getOrCreateFolderPublication({
        folderId: "missing",
        guildId: "111",
      }),
    ).rejects.toMatchObject({ code: "folder_absent" });
  });
});
