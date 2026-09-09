import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createNewsFolderRepository } from "./news-folder-repository.js";
import { NewsFolderIntegrityError } from "./news-folder-types.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(packageRoot, "prisma", "migrations");
const schemaPath = join(packageRoot, "prisma", "schema.prisma");

  function createPrismaDouble() {
  const folders: Array<Record<string, unknown>> = [];
  const memberships: Array<Record<string, unknown>> = [];
  const decisions: Array<Record<string, unknown>> = [];
  const analysisAttempts: Array<Record<string, unknown>> = [];
  let seq = 0;
  let clock = 0;

  function nextTimestamp(): Date {
    clock += 1;
    return new Date(`2026-07-16T13:${String(clock).padStart(2, "0")}:00.000Z`);
  }

  function nextId(prefix: string): string {
    seq += 1;
    return `${prefix}_${seq}`;
  }

  const newsFolder = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const now = nextTimestamp();
      const row = {
        id: nextId("fld"),
        status: "open",
        closedAt: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      folders.push(row);
      return row;
    }),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      return folders.find((row) => row.id === where.id) ?? null;
    }),
    findMany: vi.fn(
      async ({
        where,
        orderBy,
        take,
      }: {
        where?: { status?: { in: string[] } };
        orderBy?: { lastActivityAt: "asc" | "desc" };
        take?: number;
      }) => {
        let rows = [...folders];
        if (where?.status?.in !== undefined) {
          const allowed = new Set(where.status.in);
          rows = rows.filter((row) => allowed.has(row.status as string));
        }
        if (orderBy?.lastActivityAt === "desc") {
          rows.sort(
            (a, b) =>
              (b.lastActivityAt as Date).getTime() -
              (a.lastActivityAt as Date).getTime(),
          );
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
        const row = folders.find((entry) => entry.id === where.id);
        if (row === undefined) {
          throw new Error(`NewsFolder ${where.id} not found`);
        }
        Object.assign(row, data, { updatedAt: nextTimestamp() });
        return row;
      },
    ),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      const index = folders.findIndex((row) => row.id === where.id);
      if (index < 0) {
        throw new Error(`NewsFolder ${where.id} not found`);
      }
      const linkedArticles = memberships.filter(
        (row) => row.folderId === where.id,
      );
      const linkedDecisions = decisions.filter(
        (row) => row.folderId === where.id,
      );
      if (linkedArticles.length > 0 || linkedDecisions.length > 0) {
        throw new Error(
          "Foreign key constraint violation (ON DELETE RESTRICT)",
        );
      }
      const [removed] = folders.splice(index, 1);
      return removed;
    }),
  };

  const newsFolderArticle = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const conflict = memberships.find(
        (row) => row.articleId === data.articleId,
      );
      if (conflict !== undefined) {
        throw new Error("Unique constraint violation on articleId");
      }
      const folderExists = folders.some((row) => row.id === data.folderId);
      if (!folderExists) {
        throw new Error("Foreign key constraint violation (folderId)");
      }
      const row = {
        id: nextId("nfa"),
        enrichmentType: null,
        enrichmentFacts: null,
        attachedAt: nextTimestamp(),
        ...data,
      };
      memberships.push(row);
      return row;
    }),
    findUnique: vi.fn(
      async ({ where }: { where: { articleId?: string; id?: string } }) => {
        if (where.articleId !== undefined) {
          return (
            memberships.find((row) => row.articleId === where.articleId) ?? null
          );
        }
        if (where.id !== undefined) {
          return memberships.find((row) => row.id === where.id) ?? null;
        }
        return null;
      },
    ),
    findMany: vi.fn(
      async ({
        where,
        orderBy,
      }: {
        where: { folderId: string };
        orderBy?: { attachedAt: "asc" | "desc" };
      }) => {
        const rows = memberships.filter(
          (row) => row.folderId === where.folderId,
        );
        if (orderBy?.attachedAt === "asc") {
          return [...rows].sort(
            (a, b) =>
              (a.attachedAt as Date).getTime() -
              (b.attachedAt as Date).getTime(),
          );
        }
        return rows;
      },
    ),
    count: vi.fn(async ({ where }: { where: { folderId: string } }) => {
      return memberships.filter((row) => row.folderId === where.folderId)
        .length;
    }),
  };

  const matchingDecision = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (Object.prototype.hasOwnProperty.call(data, "id") === false) {
        // append-only: create only
      }
      if (data.folderId !== null && data.folderId !== undefined) {
        const folderExists = folders.some((row) => row.id === data.folderId);
        if (!folderExists) {
          throw new Error("Foreign key constraint violation (folderId)");
        }
      }
      const row = {
        id: nextId("dec"),
        folderId: null,
        motiveCodes: [],
        favorableSignals: [],
        unfavorableSignals: [],
        enrichmentFacts: null,
        proposalOrigin: null,
        reevaluable: true,
        decidedAt: nextTimestamp(),
        ...data,
      };
      decisions.push(row);
      return row;
    }),
    update: vi.fn(async () => {
      throw new Error("MatchingDecision must remain append-only");
    }),
    delete: vi.fn(async () => {
      throw new Error("MatchingDecision must remain append-only");
    }),
    count: vi.fn(async ({ where }: { where: { folderId: string } }) => {
      return decisions.filter((row) => row.folderId === where.folderId).length;
    }),
    findFirst: vi.fn(
      async ({
        where,
      }: {
        where: { articleId?: string; folderId?: string };
        select?: { id: boolean };
      }) => {
        const row = decisions.find((entry) => {
          if (
            where.articleId !== undefined &&
            entry.articleId !== where.articleId
          ) {
            return false;
          }
          if (
            where.folderId !== undefined &&
            entry.folderId !== where.folderId
          ) {
            return false;
          }
          return true;
        });
        return row === undefined ? null : { id: row.id };
      },
    ),
    findMany: vi.fn(
      async ({ where }: { where: { articleId?: string; folderId?: string } }) => {
        return decisions.filter((row) => {
          if (
            where.articleId !== undefined &&
            row.articleId !== where.articleId
          ) {
            return false;
          }
          if (
            where.folderId !== undefined &&
            row.folderId !== where.folderId
          ) {
            return false;
          }
          return true;
        });
      },
    ),
  };

  const analysisAttempt = {
    count: vi.fn(async ({ where }: { where: { folderId: string } }) => {
      return analysisAttempts.filter((row) => row.folderId === where.folderId)
        .length;
    }),
  };

  const prisma = {
    newsFolder,
    newsFolderArticle,
    matchingDecision,
    analysisAttempt,
  };

  return {
    prisma,
    folders,
    memberships,
    decisions,
    matchingDecision,
    analysisAttempts,
  };
}

describe("Prisma migration 006.1B", () => {
  it("ships NewsFolder, NewsFolderArticle, MatchingDecision and Restrict FKs", () => {
    expect(existsSync(join(migrationsDir, "migration_lock.toml"))).toBe(true);

    const schema = readFileSync(schemaPath, "utf8");
    expect(schema).toContain("model NewsFolder");
    expect(schema).toContain("model NewsFolderArticle");
    expect(schema).toContain("model MatchingDecision");
    expect(schema).toContain("enum NewsFolderStatus");
    expect(schema).toContain("enum MatchingDecisionIssue");
    expect(schema).toContain("enum MatchingConfidence");
    expect(schema).toContain("onDelete: Restrict");
    expect(schema).toContain("create_dossier");
    expect(schema).toContain("attach_enrich");
    expect(schema).toContain("duplicate_editorial");
    expect(schema).toContain("ambiguous_no_action");

    const entries = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const migrationName = entries.find((name) =>
      name.includes("news_folder_data_model"),
    );
    expect(migrationName).toBeDefined();

    const sql = readFileSync(
      join(migrationsDir, migrationName!, "migration.sql"),
      "utf8",
    );

    expect(sql).toContain('CREATE TABLE "NewsFolder"');
    expect(sql).toContain('CREATE TABLE "NewsFolderArticle"');
    expect(sql).toContain('CREATE TABLE "MatchingDecision"');
    expect(sql).toContain('"status" "NewsFolderStatus"');
    expect(sql).toContain('"lastActivityAt" TIMESTAMP(3) NOT NULL');
    expect(sql).toContain('"role" "NewsFolderArticleRole"');
    expect(sql).toContain('"issue" "MatchingDecisionIssue"');
    expect(sql).toContain('"confidence" "MatchingConfidence"');
    expect(sql).toContain('"motiveCodes" TEXT[]');
    expect(sql).toContain('"favorableSignals" TEXT[]');
    expect(sql).toContain('"unfavorableSignals" TEXT[]');
    expect(sql).toContain('"reevaluable" BOOLEAN NOT NULL');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "NewsFolderArticle_articleId_key"',
    );
    expect(sql).toContain("ON DELETE RESTRICT");
    expect(sql).toContain("create_dossier");
    expect(sql).toContain("attach_enrich");
    expect(sql).toContain("duplicate_editorial");
    expect(sql).toContain("ambiguous_no_action");
  });
});

describe("createNewsFolderRepository", () => {
  it("creates a news folder in open status by default", async () => {
    const { prisma, folders } = createPrismaDouble();
    const repo = createNewsFolderRepository(prisma as never);

    const folder = await repo.createFolder({
      title: "OpenAI announces GPT-5",
    });

    expect(folder.title).toBe("OpenAI announces GPT-5");
    expect(folder.status).toBe("open");
    expect(folder.closedAt).toBeNull();
    expect(folder.lastActivityAt).toBeInstanceOf(Date);
    expect(folders).toHaveLength(1);
  });

  it("attaches an article to a folder with primary role", async () => {
    const { prisma, memberships } = createPrismaDouble();
    const repo = createNewsFolderRepository(prisma as never);

    const folder = await repo.createFolder({ title: "Event A" });
    const link = await repo.attachArticle({
      folderId: folder.id,
      articleId: "art_primary",
      role: "primary",
    });

    expect(link.folderId).toBe(folder.id);
    expect(link.articleId).toBe("art_primary");
    expect(link.role).toBe("primary");
    expect(memberships).toHaveLength(1);
  });

  it("attaches an enrichment article with typed facts", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createNewsFolderRepository(prisma as never);

    const folder = await repo.createFolder({ title: "Event B" });
    const link = await repo.attachArticle({
      folderId: folder.id,
      articleId: "art_enrich",
      role: "enrichment",
      enrichmentType: "correction",
      enrichmentFacts: { facts: ["availability: GA"] },
    });

    expect(link.role).toBe("enrichment");
    expect(link.enrichmentType).toBe("correction");
    expect(link.enrichmentFacts).toEqual({ facts: ["availability: GA"] });
  });

  it("records matching decisions append-only without overwriting history", async () => {
    const { prisma, decisions, matchingDecision } = createPrismaDouble();
    const repo = createNewsFolderRepository(prisma as never);

    const folder = await repo.createFolder({ title: "Event C" });

    const first = await repo.recordDecision({
      issue: "create_dossier",
      articleId: "art_1",
      folderId: folder.id,
      confidence: "none",
      motiveCodes: ["no_candidate"],
      favorableSignals: [],
      unfavorableSignals: ["no_match"],
    });

    const second = await repo.recordDecision({
      issue: "attach_enrich",
      articleId: "art_2",
      folderId: folder.id,
      confidence: "high",
      motiveCodes: ["same_entities", "new_fact"],
      favorableSignals: ["shared_url", "same_version"],
      unfavorableSignals: [],
      enrichmentFacts: { facts: ["price: $20"] },
      proposalOrigin: "rule",
    });

    const third = await repo.recordDecision({
      issue: "duplicate_editorial",
      articleId: "art_3",
      folderId: folder.id,
      confidence: "high",
      motiveCodes: ["no_new_value"],
    });

    const fourth = await repo.recordDecision({
      issue: "ambiguous_no_action",
      articleId: "art_4",
      folderId: null,
      confidence: "low",
      motiveCodes: ["conflicting_entities"],
      reevaluable: true,
    });

    expect(decisions).toHaveLength(4);
    expect(first.issue).toBe("create_dossier");
    expect(second.issue).toBe("attach_enrich");
    expect(third.issue).toBe("duplicate_editorial");
    expect(fourth.issue).toBe("ambiguous_no_action");
    expect(fourth.folderId).toBeNull();
    expect(second.enrichmentFacts).toEqual({ facts: ["price: $20"] });
    // History preserved: prior decisions unchanged after later inserts.
    expect(decisions[0]!.id).toBe(first.id);
    expect(decisions[0]!.issue).toBe("create_dossier");
    expect(matchingDecision.update).not.toHaveBeenCalled();
    expect(matchingDecision.delete).not.toHaveBeenCalled();
  });

  it("reads a folder and its articles", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createNewsFolderRepository(prisma as never);

    const folder = await repo.createFolder({ title: "Readable folder" });
    await repo.attachArticle({
      folderId: folder.id,
      articleId: "art_a",
      role: "primary",
    });
    await repo.attachArticle({
      folderId: folder.id,
      articleId: "art_b",
      role: "enrichment",
      enrichmentType: "confirmation",
    });

    const loaded = await repo.getFolder(folder.id);
    const articles = await repo.listFolderArticles(folder.id);

    expect(loaded).not.toBeNull();
    expect(loaded!.title).toBe("Readable folder");
    expect(articles).toHaveLength(2);
    expect(articles.map((row) => row.articleId)).toEqual(["art_a", "art_b"]);
  });

  it("enforces active membership uniqueness (one folder per article)", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createNewsFolderRepository(prisma as never);

    const folderA = await repo.createFolder({ title: "Folder A" });
    const folderB = await repo.createFolder({ title: "Folder B" });

    await repo.attachArticle({
      folderId: folderA.id,
      articleId: "art_shared",
      role: "primary",
    });

    await expect(
      repo.attachArticle({
        folderId: folderB.id,
        articleId: "art_shared",
        role: "enrichment",
      }),
    ).rejects.toThrow(/Unique constraint/);
  });

  it("refuses folder deletion when memberships or decisions exist", async () => {
    const { prisma, folders } = createPrismaDouble();
    const repo = createNewsFolderRepository(prisma as never);

    const withArticle = await repo.createFolder({ title: "Has article" });
    await repo.attachArticle({
      folderId: withArticle.id,
      articleId: "art_x",
      role: "primary",
    });

    await expect(repo.deleteFolder(withArticle.id)).rejects.toBeInstanceOf(
      NewsFolderIntegrityError,
    );
    expect(folders.some((row) => row.id === withArticle.id)).toBe(true);

    const withDecision = await repo.createFolder({ title: "Has decision" });
    await repo.recordDecision({
      issue: "create_dossier",
      articleId: "art_y",
      folderId: withDecision.id,
      confidence: "none",
      motiveCodes: ["primary"],
    });

    await expect(repo.deleteFolder(withDecision.id)).rejects.toBeInstanceOf(
      NewsFolderIntegrityError,
    );
    expect(folders.some((row) => row.id === withDecision.id)).toBe(true);
  });

  it("allows folder deletion when no relations remain", async () => {
    const { prisma, folders } = createPrismaDouble();
    const repo = createNewsFolderRepository(prisma as never);

    const empty = await repo.createFolder({ title: "Empty" });
    await repo.deleteFolder(empty.id);

    expect(folders.some((row) => row.id === empty.id)).toBe(false);
    expect(await repo.getFolder(empty.id)).toBeNull();
  });

  it("preserves referential integrity on missing folder attach", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createNewsFolderRepository(prisma as never);

    await expect(
      repo.attachArticle({
        folderId: "missing_folder",
        articleId: "art_z",
        role: "primary",
      }),
    ).rejects.toThrow(/Foreign key/);
  });
});
