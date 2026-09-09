/**
 * Test harness for 008.1F — Prisma double + orchestrator wiring.
 * Not exported from package index; used only by integration / acceptance tests.
 */
import { vi } from "vitest";

import type { NewsFolderRepository } from "./news-folder-repository.js";
import {
  createPublicationOrchestrator,
  type PublicationOrchestrator,
} from "./publication-orchestrator.js";
import type {
  DiscordPublicationPort,
  PublicationOrchestrationInput,
} from "./publication-orchestration-types.js";
import { createPublicationRepository } from "./publication-repository.js";
import type { PublicationRepository } from "./publication-repository.js";

export const GUILD_ID = "guild_integration_1";
export const CHANNEL_ID = "channel_veille_1";
export const FOLDER_ID = "fld_integration_1";
export const ANALYSIS_ID = "att_analysis_integration_1";
export const FINGERPRINT = "fp_enrich_integration_abcdef0123456789";

export type FolderSeed = {
  id: string;
  status: "open" | "idle" | "closed";
  title?: string;
  lastActivityAt?: Date;
};

export function createPrismaDouble(
  seedFolders: FolderSeed[] = [
    {
      id: FOLDER_ID,
      status: "open",
      title: "OpenAI GPT-5",
      lastActivityAt: new Date("2026-07-16T20:00:00.000Z"),
    },
  ],
) {
  const folders = seedFolders.map((f) => ({
    title: "OpenAI GPT-5",
    lastActivityAt: new Date("2026-07-16T20:00:00.000Z"),
    closedAt: f.status === "closed" ? new Date("2026-07-16T19:00:00.000Z") : null,
    createdAt: new Date("2026-07-16T19:00:00.000Z"),
    updatedAt: new Date("2026-07-16T20:00:00.000Z"),
    ...f,
  }));
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
        take,
      }: {
        where?: { status?: { in: string[] } | string };
        orderBy?: Array<Record<string, "asc" | "desc">>;
        take?: number;
      }) => {
        let rows = [...publications];
        if (where?.status !== undefined) {
          if (typeof where.status === "string") {
            rows = rows.filter((row) => row.status === where.status);
          } else if (where.status.in !== undefined) {
            const allowed = new Set(where.status.in);
            rows = rows.filter((row) => allowed.has(row.status as string));
          }
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
        executionHolderId: null,
        executionLeaseExpiresAt: null,
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
          const allowed = new Set((where.status as { in: string[] }).in);
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
            const allowed = new Set((where.status as { in: string[] }).in);
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
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const id = where.id as string;
        const row = attempts.find((entry) => entry.id === id);
        if (row === undefined) {
          return { count: 0 };
        }
        if (where.status !== undefined && row.status !== where.status) {
          return { count: 0 };
        }
        const or = where.OR as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(or)) {
          const now = new Date();
          const ok = or.some((clause) => {
            if (clause.executionHolderId === null) {
              return row.executionHolderId == null;
            }
            if (
              clause.executionLeaseExpiresAt !== undefined &&
              typeof clause.executionLeaseExpiresAt === "object" &&
              clause.executionLeaseExpiresAt !== null &&
              "lte" in (clause.executionLeaseExpiresAt as object)
            ) {
              const lte = (clause.executionLeaseExpiresAt as { lte: Date }).lte;
              return (
                row.executionLeaseExpiresAt != null &&
                (row.executionLeaseExpiresAt as Date).getTime() <= lte.getTime()
              );
            }
            if (typeof clause.executionHolderId === "string") {
              return row.executionHolderId === clause.executionHolderId;
            }
            return false;
          });
          if (!ok) {
            return { count: 0 };
          }
          void now;
        }
        Object.assign(row, data);
        return { count: 1 };
      },
    ),
  };

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
    __folders: folders,
    __failNextCreate: () => {
      failNextCreate = true;
    },
  };

  return prisma;
}

export type PrismaDouble = ReturnType<typeof createPrismaDouble>;

export function createFolderRepositoryFromPrisma(
  prisma: PrismaDouble,
): NewsFolderRepository {
  return {
    createFolder: vi.fn(),
    attachArticle: vi.fn(),
    recordDecision: vi.fn(),
    updateFolder: vi.fn(),
    getFolder: vi.fn(async (folderId: string) => {
      const row = await prisma.newsFolder.findUnique({ where: { id: folderId } });
      return row as never;
    }),
    listFolderArticles: vi.fn(async () => []),
    listFolderArticlesByFolderIds: vi.fn(async () => []),
    listFoldersByStatuses: vi.fn(async () => []),
    getArticleMembership: vi.fn(async () => null),
    hasMatchingDecisionForArticle: vi.fn(async () => false),
    deleteFolder: vi.fn(),
  };
}

export function createMockDiscordPort(
  overrides: Partial<DiscordPublicationPort> = {},
): DiscordPublicationPort & {
  calls: {
    sendMainMessage: number;
    startThread: number;
    unarchiveThreadIfNeeded: number;
    sendThreadMessage: number;
  };
} {
  const calls = {
    sendMainMessage: 0,
    startThread: 0,
    unarchiveThreadIfNeeded: 0,
    sendThreadMessage: 0,
  };

  return {
    calls,
    sendMainMessage: vi.fn(async () => {
      calls.sendMainMessage += 1;
      return { messageId: "msg_main_1" };
    }),
    startThread: vi.fn(async () => {
      calls.startThread += 1;
      return { threadId: "thr_1" };
    }),
    unarchiveThreadIfNeeded: vi.fn(async () => {
      calls.unarchiveThreadIfNeeded += 1;
    }),
    sendThreadMessage: vi.fn(async () => {
      calls.sendThreadMessage += 1;
      return { messageId: "msg_thr_1" };
    }),
    ...overrides,
  };
}

export function publishInput(
  overrides: Partial<PublicationOrchestrationInput> = {},
): PublicationOrchestrationInput {
  return {
    folderId: FOLDER_ID,
    decision: "publish",
    analysisAttemptId: ANALYSIS_ID,
    channelHint: "veille_pertinente",
    aggregateFingerprint: null,
    validatedContent: {
      summary: "Résumé validé de l'annonce GPT-5.",
      primaryCategory: "model_release",
      publishWorthiness: "medium",
      composite: 72,
    },
    sources: [{ name: "OpenAI", url: "https://openai.com/blog/gpt-5" }],
    usefulDate: "2026-07-16",
    ...overrides,
  };
}

export function enrichInput(
  overrides: Partial<PublicationOrchestrationInput> = {},
): PublicationOrchestrationInput {
  return {
    folderId: FOLDER_ID,
    decision: "enrich_thread_only",
    analysisAttemptId: ANALYSIS_ID,
    channelHint: null,
    aggregateFingerprint: FINGERPRINT,
    newFacts: [{ key: "model", value: "GPT-5" }],
    newSources: [],
    ...overrides,
  };
}

export function createPipeline(options: {
  prisma?: PrismaDouble;
  discord?: Partial<DiscordPublicationPort>;
  resolveChannelId?: (hint: string) => string | null;
  folderId?: string;
} = {}): {
  prisma: PrismaDouble;
  repository: PublicationRepository;
  discord: ReturnType<typeof createMockDiscordPort>;
  orchestrator: PublicationOrchestrator;
} {
  const prisma = options.prisma ?? createPrismaDouble();
  const repository = createPublicationRepository(prisma as never);
  const discord = createMockDiscordPort(options.discord);
  const folderRepository = createFolderRepositoryFromPrisma(prisma);

  const orchestrator = createPublicationOrchestrator(prisma as never, {
    discordPort: discord,
    resolveChannelId:
      options.resolveChannelId ??
      ((hint) => (hint === "veille_pertinente" ? CHANNEL_ID : null)),
    guildId: GUILD_ID,
    publicationRepository: repository,
    folderRepository,
    now: () => new Date("2026-07-16T21:30:00.000Z"),
  });

  return { prisma, repository, discord, orchestrator };
}
