import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createNormalizedArticleRepository } from "./normalized-article-repository.js";
import type { SaveNormalizedArticleInput } from "./normalized-article-types.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(packageRoot, "prisma", "migrations");
const schemaPath = join(packageRoot, "prisma", "schema.prisma");

function baseArticle(
  overrides: Partial<SaveNormalizedArticleInput> = {},
): SaveNormalizedArticleInput {
  return {
    sourceId: "openai-blog",
    sourceTier: "S",
    title: "Example Article",
    url: "https://example.com/posts/example",
    categories: ["AI", "Research"],
    feedFormat: "rss",
    ...overrides,
  };
}

function createPrismaDouble() {
  const articles: Array<Record<string, unknown>> = [];
  let seq = 0;
  let clock = 0;

  function nextTimestamp(): Date {
    clock += 1;
    return new Date(`2026-07-16T13:${String(clock).padStart(2, "0")}:00.000Z`);
  }

  function matchesIdentity(
    row: Record<string, unknown>,
    where: Record<string, unknown>,
  ): boolean {
    if (where.sourceId !== undefined && row.sourceId !== where.sourceId) {
      return false;
    }
    if (Object.prototype.hasOwnProperty.call(where, "externalId")) {
      if (where.externalId === null) {
        if (row.externalId !== null && row.externalId !== undefined) {
          return false;
        }
      } else if (row.externalId !== where.externalId) {
        return false;
      }
    }
    if (where.url !== undefined && row.url !== where.url) {
      return false;
    }
    return true;
  }

  const normalizedArticle = {
    findFirst: vi.fn(
      async ({ where }: { where: Record<string, unknown> }) => {
        return articles.find((row) => matchesIdentity(row, where)) ?? null;
      },
    ),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const now = nextTimestamp();
      // Enforce partial unique indexes (mirror PostgreSQL migration).
      const conflict = articles.find((row) => {
        if (row.sourceId !== data.sourceId) {
          return false;
        }
        if (data.externalId !== null && data.externalId !== undefined) {
          return row.externalId === data.externalId;
        }
        return (
          (row.externalId === null || row.externalId === undefined) &&
          row.url === data.url
        );
      });
      if (conflict !== undefined) {
        throw new Error("Unique constraint violation (partial index)");
      }
      seq += 1;
      const row = {
        id: `art_${seq}`,
        ...data,
        createdAt: now,
        persistedUpdatedAt: now,
      };
      articles.push(row);
      return row;
    }),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const index = articles.findIndex((row) => row.id === where.id);
        if (index < 0) {
          throw new Error(`NormalizedArticle ${where.id} not found`);
        }
        const existing = articles[index]!;
        const next: Record<string, unknown> = {
          ...existing,
          id: existing.id,
          createdAt: existing.createdAt,
          persistedUpdatedAt: nextTimestamp(),
        };
        for (const [key, value] of Object.entries(data)) {
          if (
            value !== null &&
            typeof value === "object" &&
            "set" in (value as object)
          ) {
            next[key] = (value as { set: unknown }).set;
          } else {
            next[key] = value;
          }
        }
        articles[index] = next;
        return next;
      },
    ),
  };

  const prisma = {
    normalizedArticle,
    $transaction: vi.fn(async (fn: (tx: typeof prisma) => Promise<unknown>) => {
      return fn(prisma);
    }),
  };

  return { prisma, articles };
}

describe("Prisma migration 005.1A", () => {
  it("ships NormalizedArticle model columns and partial unique indexes", () => {
    expect(existsSync(join(migrationsDir, "migration_lock.toml"))).toBe(true);

    const schema = readFileSync(schemaPath, "utf8");
    expect(schema).toContain("model NormalizedArticle");
    expect(schema).toContain("sourceId");
    expect(schema).toContain("sourceTier");
    expect(schema).toContain("externalId");
    expect(schema).toContain("persistedUpdatedAt");
    expect(schema).toContain("categories");

    const entries = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const migrationName = entries.find((name) =>
      name.includes("normalized_article_persistence"),
    );
    expect(migrationName).toBeDefined();

    const sql = readFileSync(
      join(migrationsDir, migrationName!, "migration.sql"),
      "utf8",
    );

    expect(sql).toContain('CREATE TABLE "NormalizedArticle"');
    expect(sql).toContain('"sourceId" TEXT NOT NULL');
    expect(sql).toContain('"sourceTier" TEXT NOT NULL');
    expect(sql).toContain('"externalId" TEXT');
    expect(sql).toContain('"title" TEXT NOT NULL');
    expect(sql).toContain('"url" TEXT NOT NULL');
    expect(sql).toContain('"publishedAt" TIMESTAMP(3)');
    expect(sql).toContain('"updatedAt" TIMESTAMP(3)');
    expect(sql).toContain('"author" TEXT');
    expect(sql).toContain('"summary" TEXT');
    expect(sql).toContain('"content" TEXT');
    expect(sql).toContain('"categories" TEXT[]');
    expect(sql).toContain('"feedFormat" TEXT NOT NULL');
    expect(sql).toContain('"createdAt" TIMESTAMP(3) NOT NULL');
    expect(sql).toContain('"persistedUpdatedAt" TIMESTAMP(3) NOT NULL');
    expect(sql).toContain(
      'CREATE INDEX "NormalizedArticle_sourceId_idx"',
    );
    expect(sql).toContain(
      'CREATE INDEX "NormalizedArticle_sourceId_publishedAt_idx"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "NormalizedArticle_sourceId_externalId_key"',
    );
    expect(sql).toContain('WHERE "externalId" IS NOT NULL');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "NormalizedArticle_sourceId_url_key"',
    );
    expect(sql).toContain('WHERE "externalId" IS NULL');
    // No abusive global uniqueness on url or externalId alone.
    expect(sql).not.toMatch(
      /CREATE UNIQUE INDEX "[^"]+"\s+ON "NormalizedArticle"\("url"\)/,
    );
    expect(sql).not.toMatch(
      /CREATE UNIQUE INDEX "[^"]+"\s+ON "NormalizedArticle"\("externalId"\)/,
    );
  });
});

describe("createNormalizedArticleRepository", () => {
  it("creates an article with externalId", async () => {
    const { prisma, articles } = createPrismaDouble();
    const repo = createNormalizedArticleRepository(prisma as never);

    const result = await repo.saveNormalizedArticle(
      baseArticle({
        externalId: "guid-1",
        publishedAt: "2026-07-15T10:00:00.000Z",
        author: "Ada",
      }),
    );

    expect(result.outcome).toBe("created");
    expect(result.article.externalId).toBe("guid-1");
    expect(result.article.sourceId).toBe("openai-blog");
    expect(articles).toHaveLength(1);
  });

  it("creates an article without externalId", async () => {
    const { prisma, articles } = createPrismaDouble();
    const repo = createNormalizedArticleRepository(prisma as never);

    const result = await repo.saveNormalizedArticle(baseArticle());

    expect(result.outcome).toBe("created");
    expect(result.article.externalId).toBeNull();
    expect(result.article.url).toBe("https://example.com/posts/example");
    expect(articles).toHaveLength(1);
  });

  it("reappearing same sourceId + externalId updates without duplicate", async () => {
    const { prisma, articles } = createPrismaDouble();
    const repo = createNormalizedArticleRepository(prisma as never);

    const first = await repo.saveNormalizedArticle(
      baseArticle({ externalId: "same-guid", title: "V1" }),
    );
    const second = await repo.saveNormalizedArticle(
      baseArticle({
        externalId: "same-guid",
        title: "V2",
        summary: "Updated summary",
      }),
    );

    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("updated");
    expect(articles).toHaveLength(1);
    expect(second.article.id).toBe(first.article.id);
    expect(second.article.title).toBe("V2");
    expect(second.article.summary).toBe("Updated summary");
  });

  it("reappearing same sourceId + url without externalId updates without duplicate", async () => {
    const { prisma, articles } = createPrismaDouble();
    const repo = createNormalizedArticleRepository(prisma as never);
    const url = "https://example.com/posts/no-guid";

    const first = await repo.saveNormalizedArticle(
      baseArticle({ url, title: "First" }),
    );
    const second = await repo.saveNormalizedArticle(
      baseArticle({ url, title: "Second", content: "<p>body</p>" }),
    );

    expect(first.outcome).toBe("created");
    expect(second.outcome).toBe("updated");
    expect(articles).toHaveLength(1);
    expect(second.article.id).toBe(first.article.id);
    expect(second.article.title).toBe("Second");
    expect(second.article.content).toBe("<p>body</p>");
  });

  it("keeps an article unchanged for volatile metadata only", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createNormalizedArticleRepository(prisma as never);
    await repo.saveNormalizedArticle(
      baseArticle({
        externalId: "volatile",
        url: "https://example.com/posts/example?utm_source=rss",
        title: "  Same title ",
        content: "Same\nbody",
        categories: ["AI", "Research"],
      }),
    );
    const result = await repo.saveNormalizedArticle(
      baseArticle({
        externalId: "volatile",
        url: "https://example.com/posts/example?utm_campaign=weekly",
        updatedAt: "2026-08-01T00:00:00.000Z",
        title: "Same title",
        content: "Same body",
        categories: ["research", "ai"],
      }),
    );
    expect(result.outcome).toBe("unchanged");
  });

  it("updates an article when its editorial title changes", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createNormalizedArticleRepository(prisma as never);
    await repo.saveNormalizedArticle(baseArticle({ externalId: "editorial", title: "First title" }));
    const result = await repo.saveNormalizedArticle(
      baseArticle({ externalId: "editorial", title: "Corrected title" }),
    );
    expect(result.outcome).toBe("updated");
    expect(result.changedFields).toContain("title");
  });

  it("allows the same externalId for two different sources", async () => {
    const { prisma, articles } = createPrismaDouble();
    const repo = createNormalizedArticleRepository(prisma as never);

    await repo.saveNormalizedArticle(
      baseArticle({
        sourceId: "source-a",
        externalId: "shared-guid",
        url: "https://a.example/1",
      }),
    );
    await repo.saveNormalizedArticle(
      baseArticle({
        sourceId: "source-b",
        externalId: "shared-guid",
        url: "https://b.example/1",
      }),
    );

    expect(articles).toHaveLength(2);
    expect(articles.map((row) => row.sourceId).sort()).toEqual([
      "source-a",
      "source-b",
    ]);
  });

  it("allows the same URL for two different sources", async () => {
    const { prisma, articles } = createPrismaDouble();
    const repo = createNormalizedArticleRepository(prisma as never);
    const url = "https://syndicated.example/shared";

    await repo.saveNormalizedArticle(
      baseArticle({ sourceId: "press-a", url }),
    );
    await repo.saveNormalizedArticle(
      baseArticle({ sourceId: "press-b", url }),
    );

    expect(articles).toHaveLength(2);
  });

  it("updates normalized fields deterministically and preserves identity + createdAt", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createNormalizedArticleRepository(prisma as never);

    const created = await repo.saveNormalizedArticle(
      baseArticle({
        externalId: "stable",
        title: "Original",
        sourceTier: "S",
        categories: ["Old"],
        publishedAt: "2026-07-01T00:00:00.000Z",
      }),
    );

    const updated = await repo.saveNormalizedArticle(
      baseArticle({
        externalId: "stable",
        title: "Revised",
        sourceTier: "A",
        categories: ["New", "Tags"],
        publishedAt: "2026-07-02T00:00:00.000Z",
        updatedAt: "2026-07-03T00:00:00.000Z",
        author: "Bob",
        summary: "Sum",
        content: "<em>html</em>",
        feedFormat: "atom",
      }),
    );

    expect(updated.article.id).toBe(created.article.id);
    expect(updated.article.createdAt).toEqual(created.article.createdAt);
    expect(updated.article.persistedUpdatedAt.getTime()).toBeGreaterThan(
      created.article.persistedUpdatedAt.getTime(),
    );
    expect(updated.article.title).toBe("Revised");
    expect(updated.article.sourceTier).toBe("A");
    expect(updated.article.categories).toEqual(["New", "Tags"]);
    expect(updated.article.publishedAt).toEqual(
      new Date("2026-07-02T00:00:00.000Z"),
    );
    expect(updated.article.updatedAt).toEqual(
      new Date("2026-07-03T00:00:00.000Z"),
    );
    expect(updated.article.author).toBe("Bob");
    expect(updated.article.summary).toBe("Sum");
    expect(updated.article.content).toBe("<em>html</em>");
    expect(updated.article.feedFormat).toBe("atom");
  });

  it("persists categories, dates and optional fields", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createNormalizedArticleRepository(prisma as never);

    const result = await repo.saveNormalizedArticle(
      baseArticle({
        externalId: "opt-1",
        publishedAt: "2026-07-10T08:30:00.000Z",
        updatedAt: "2026-07-11T09:00:00.000Z",
        author: "Carol",
        summary: "  raw summary ",
        content: "<p>Raw <b>HTML</b></p>",
        categories: ["ML", "NLP", "ml"],
      }),
    );

    expect(result.article.categories).toEqual(["ML", "NLP", "ml"]);
    expect(result.article.publishedAt).toEqual(
      new Date("2026-07-10T08:30:00.000Z"),
    );
    expect(result.article.updatedAt).toEqual(
      new Date("2026-07-11T09:00:00.000Z"),
    );
    expect(result.article.author).toBe("Carol");
    expect(result.article.summary).toBe("  raw summary ");
    expect(result.article.content).toBe("<p>Raw <b>HTML</b></p>");
  });

  it("persists a batch atomically with deterministic create/update counts", async () => {
    const { prisma, articles } = createPrismaDouble();
    const repo = createNormalizedArticleRepository(prisma as never);

    await repo.saveNormalizedArticle(
      baseArticle({ externalId: "batch-1", title: "Old" }),
    );

    const batch = await repo.saveNormalizedArticles([
      baseArticle({ externalId: "batch-1", title: "New" }),
      baseArticle({
        externalId: "batch-2",
        url: "https://example.com/posts/two",
        title: "Two",
      }),
      baseArticle({
        sourceId: "other-source",
        url: "https://example.com/posts/example",
        title: "Other source same URL",
      }),
    ]);

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(batch.created).toBe(2);
    expect(batch.updated).toBe(1);
    expect(batch.articles).toHaveLength(3);
    expect(articles).toHaveLength(3);
    expect(
      articles.find((row) => row.externalId === "batch-1")?.title,
    ).toBe("New");
  });

  it("does not deduplicate across sources (no editorial merge)", async () => {
    const { prisma, articles } = createPrismaDouble();
    const repo = createNormalizedArticleRepository(prisma as never);

    // Same title, similar URL path, same external-looking id text — still separate rows.
    await repo.saveNormalizedArticle(
      baseArticle({
        sourceId: "src-1",
        externalId: "event-42",
        title: "GPT launch",
        url: "https://a.example/gpt",
      }),
    );
    await repo.saveNormalizedArticle(
      baseArticle({
        sourceId: "src-2",
        externalId: "event-42",
        title: "GPT launch",
        url: "https://b.example/gpt",
      }),
    );
    await repo.saveNormalizedArticle(
      baseArticle({
        sourceId: "src-3",
        title: "GPT launch",
        url: "https://c.example/gpt",
      }),
    );

    expect(articles).toHaveLength(3);
    expect(new Set(articles.map((row) => row.sourceId)).size).toBe(3);
  });
});
