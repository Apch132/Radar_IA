import type { Prisma, PrismaClient } from "@prisma/client";

import {
  isEditorialUnchanged,
  type EditorialFieldName,
} from "./editorial-content.js";
import type {
  NormalizedArticle,
  PersistNormalizedArticleResult,
  PersistNormalizedArticlesResult,
  SaveNormalizedArticleInput,
} from "./normalized-article-types.js";

export interface NormalizedArticleRepository {
  /** Create or update one normalized article (technical identity). */
  saveNormalizedArticle(
    input: SaveNormalizedArticleInput,
  ): Promise<PersistNormalizedArticleResult>;
  /** Persist a batch atomically; returns create/update counts. */
  saveNormalizedArticles(
    inputs: readonly SaveNormalizedArticleInput[],
  ): Promise<PersistNormalizedArticlesResult>;
  /** Load normalized articles by id (order follows `ids`; missing ids omitted). */
  getNormalizedArticlesByIds(
    ids: readonly string[],
  ): Promise<NormalizedArticle[]>;
}

export type { EditorialFieldName };

type ArticleDb = {
  normalizedArticle: {
    findFirst: PrismaClient["normalizedArticle"]["findFirst"];
    findMany: PrismaClient["normalizedArticle"]["findMany"];
    create: PrismaClient["normalizedArticle"]["create"];
    update: PrismaClient["normalizedArticle"]["update"];
  };
};

function hasExternalId(input: SaveNormalizedArticleInput): boolean {
  return input.externalId !== undefined && input.externalId.trim() !== "";
}

function identityWhere(
  input: SaveNormalizedArticleInput,
): Prisma.NormalizedArticleWhereInput {
  if (hasExternalId(input)) {
    return {
      sourceId: input.sourceId,
      externalId: input.externalId!.trim(),
    };
  }

  return {
    sourceId: input.sourceId,
    url: input.url,
    externalId: null,
  };
}

function toOptionalDate(value: string | undefined): Date | null {
  if (value === undefined) {
    return null;
  }
  return new Date(value);
}

function toCreateData(
  input: SaveNormalizedArticleInput,
): Prisma.NormalizedArticleCreateInput {
  return {
    sourceId: input.sourceId,
    sourceTier: input.sourceTier,
    externalId: hasExternalId(input) ? input.externalId!.trim() : null,
    title: input.title,
    url: input.url,
    publishedAt: toOptionalDate(input.publishedAt),
    updatedAt: toOptionalDate(input.updatedAt),
    author: input.author ?? null,
    summary: input.summary ?? null,
    content: input.content ?? null,
    categories: [...input.categories],
    feedFormat: input.feedFormat,
  };
}

function toUpdateData(
  input: SaveNormalizedArticleInput,
): Prisma.NormalizedArticleUpdateInput {
  return {
    sourceTier: input.sourceTier,
    title: input.title,
    url: input.url,
    publishedAt: toOptionalDate(input.publishedAt),
    updatedAt: toOptionalDate(input.updatedAt),
    author: input.author ?? null,
    summary: input.summary ?? null,
    content: input.content ?? null,
    categories: { set: [...input.categories] },
    feedFormat: input.feedFormat,
  };
}

async function persistOne(
  db: ArticleDb,
  input: SaveNormalizedArticleInput,
): Promise<PersistNormalizedArticleResult> {
  const existing = await db.normalizedArticle.findFirst({
    where: identityWhere(input),
  });

  if (existing === null) {
    const article = await db.normalizedArticle.create({
      data: toCreateData(input),
    });
    return { outcome: "created", article, changedFields: [] };
  }

  const editorial = isEditorialUnchanged(existing, input);
  if (editorial.unchanged) {
    return {
      outcome: "unchanged",
      article: existing,
      changedFields: [],
      editorialHash: editorial.editorialHash,
    };
  }

  const article = await db.normalizedArticle.update({
    where: { id: existing.id },
    data: toUpdateData(input),
  });
  return {
    outcome: "updated",
    article,
    changedFields: editorial.changedFields,
    editorialHash: editorial.editorialHash,
  };
}

/**
 * Factory for the normalized article persistence repository.
 * Prisma client is injected for testability; no hidden global connection.
 */
export function createNormalizedArticleRepository(
  prisma: PrismaClient,
): NormalizedArticleRepository {
  return {
    async saveNormalizedArticle(input) {
      return persistOne(prisma, input);
    },

    async saveNormalizedArticles(inputs) {
      return prisma.$transaction(async (tx) => {
        const articles: PersistNormalizedArticlesResult["articles"] = [];
        let created = 0;
        let updated = 0;
        let unchanged = 0;

        for (const input of inputs) {
          const result = await persistOne(tx, input);
          articles.push(result.article);
          if (result.outcome === "created") {
            created += 1;
          } else if (result.outcome === "updated") {
            updated += 1;
          } else {
            unchanged += 1;
          }
        }

        return { created, updated, unchanged, articles };
      });
    },

    async getNormalizedArticlesByIds(ids) {
      if (ids.length === 0) {
        return [];
      }
      const uniqueIds = [...new Set(ids)];
      const rows = await prisma.normalizedArticle.findMany({
        where: { id: { in: [...uniqueIds] } },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const ordered: NormalizedArticle[] = [];
      for (const id of ids) {
        const row = byId.get(id);
        if (row !== undefined) {
          ordered.push(row);
        }
      }
      return ordered;
    },
  };
}
