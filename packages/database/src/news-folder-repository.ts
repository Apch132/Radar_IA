import type { PrismaClient } from "@prisma/client";

import type {
  AttachArticleToFolderInput,
  CreateNewsFolderInput,
  MatchingDecision,
  NewsFolder,
  NewsFolderArticle,
  NewsFolderStatus,
  RecordMatchingDecisionInput,
  UpdateNewsFolderInput,
} from "./news-folder-types.js";
import { NewsFolderIntegrityError } from "./news-folder-types.js";

export interface NewsFolderRepository {
  /** Create a news folder (event materialization). */
  createFolder(input: CreateNewsFolderInput): Promise<NewsFolder>;
  /** Attach an article to a folder (active membership). */
  attachArticle(input: AttachArticleToFolderInput): Promise<NewsFolderArticle>;
  /** Append a matching decision (append-only history). */
  recordDecision(
    input: RecordMatchingDecisionInput,
  ): Promise<MatchingDecision>;
  /** Update folder metadata (status / lastActivityAt / title). */
  updateFolder(input: UpdateNewsFolderInput): Promise<NewsFolder>;
  /** Read one folder by id. */
  getFolder(folderId: string): Promise<NewsFolder | null>;
  /** List article memberships for a folder (oldest first). */
  listFolderArticles(folderId: string): Promise<NewsFolderArticle[]>;
  /** Load memberships for candidate folders in one query (oldest first per folder). */
  listFolderArticlesByFolderIds(
    folderIds: readonly string[],
  ): Promise<NewsFolderArticle[]>;
  /**
   * List folders by status (minimal matching candidate selection — 009.1C).
   * Ordered by `lastActivityAt` desc. No advanced search.
   */
  listFoldersByStatuses(
    statuses: readonly NewsFolderStatus[],
    options?: { take?: number },
  ): Promise<NewsFolder[]>;
  /** Active folder membership for an article, if any. */
  getArticleMembership(
    articleId: string,
  ): Promise<NewsFolderArticle | null>;
  /** Whether a matching decision already exists for this article. */
  hasMatchingDecisionForArticle(articleId: string): Promise<boolean>;
  /**
   * Delete a folder only when it has no memberships and no decisions.
   * Throws NewsFolderIntegrityError otherwise.
   */
  deleteFolder(folderId: string): Promise<void>;
}

/**
 * Factory for the news folder data repository (006.1B).
 * CRUD / persistence only — no matching algorithm.
 * Prisma client is injected for testability.
 */
export function createNewsFolderRepository(
  prisma: PrismaClient,
): NewsFolderRepository {
  return {
    async createFolder(input) {
      const now = new Date();
      return prisma.newsFolder.create({
        data: {
          title: input.title,
          status: input.status ?? "open",
          lastActivityAt: input.lastActivityAt ?? now,
          closedAt: input.closedAt ?? null,
        },
      });
    },

    async attachArticle(input) {
      return prisma.newsFolderArticle.create({
        data: {
          folderId: input.folderId,
          articleId: input.articleId,
          role: input.role,
          enrichmentType: input.enrichmentType ?? null,
          enrichmentFacts: input.enrichmentFacts ?? undefined,
          attachedAt: input.attachedAt ?? new Date(),
        },
      });
    },

    async recordDecision(input) {
      return prisma.matchingDecision.create({
        data: {
          issue: input.issue,
          articleId: input.articleId,
          folderId: input.folderId ?? null,
          confidence: input.confidence,
          motiveCodes: input.motiveCodes ? [...input.motiveCodes] : [],
          favorableSignals: input.favorableSignals
            ? [...input.favorableSignals]
            : [],
          unfavorableSignals: input.unfavorableSignals
            ? [...input.unfavorableSignals]
            : [],
          enrichmentFacts: input.enrichmentFacts ?? undefined,
          proposalOrigin: input.proposalOrigin ?? null,
          reevaluable: input.reevaluable ?? true,
          decidedAt: input.decidedAt ?? new Date(),
        },
      });
    },

    async updateFolder(input) {
      const data: {
        title?: string;
        status?: UpdateNewsFolderInput["status"];
        lastActivityAt?: Date;
        closedAt?: Date | null;
      } = {};

      if (input.title !== undefined) {
        data.title = input.title;
      }
      if (input.status !== undefined) {
        data.status = input.status;
      }
      if (input.lastActivityAt !== undefined) {
        data.lastActivityAt = input.lastActivityAt;
      }
      if (input.closedAt !== undefined) {
        data.closedAt = input.closedAt;
      }

      return prisma.newsFolder.update({
        where: { id: input.folderId },
        data,
      });
    },

    async getFolder(folderId) {
      return prisma.newsFolder.findUnique({ where: { id: folderId } });
    },

    async listFolderArticles(folderId) {
      return prisma.newsFolderArticle.findMany({
        where: { folderId },
        orderBy: { attachedAt: "asc" },
      });
    },

    async listFolderArticlesByFolderIds(folderIds) {
      if (folderIds.length === 0) {
        return [];
      }
      return prisma.newsFolderArticle.findMany({
        where: { folderId: { in: [...folderIds] } },
        orderBy: [{ folderId: "asc" }, { attachedAt: "asc" }],
      });
    },

    async listFoldersByStatuses(statuses, options = {}) {
      if (statuses.length === 0) {
        return [];
      }
      const take = options.take ?? 500;
      return prisma.newsFolder.findMany({
        where: { status: { in: [...statuses] } },
        orderBy: { lastActivityAt: "desc" },
        take,
      });
    },

    async getArticleMembership(articleId) {
      return prisma.newsFolderArticle.findUnique({
        where: { articleId },
      });
    },

    async hasMatchingDecisionForArticle(articleId) {
      const row = await prisma.matchingDecision.findFirst({
        where: { articleId },
        select: { id: true },
      });
      return row !== null;
    },

    async deleteFolder(folderId) {
      const [articleCount, decisionCount, analysisCount] = await Promise.all([
        prisma.newsFolderArticle.count({ where: { folderId } }),
        prisma.matchingDecision.count({ where: { folderId } }),
        prisma.analysisAttempt.count({ where: { folderId } }),
      ]);

      if (articleCount > 0 || decisionCount > 0 || analysisCount > 0) {
        throw new NewsFolderIntegrityError(
          `Cannot delete news folder ${folderId}: ${articleCount} article membership(s), ${decisionCount} decision(s) and ${analysisCount} analysis attempt(s) still reference it`,
        );
      }

      await prisma.newsFolder.delete({ where: { id: folderId } });
    },
  };
}
