import type { PrismaClient } from "@prisma/client";
import {
  createAnalysisService,
  type AnalysisArticleInput,
  type AnalysisService,
  type AnalysisServiceClock,
  type AnalysisServiceResult,
  type CreateAnalysisServiceDependencies,
  type EnrichmentFactInput,
  type LastAcceptedAnalysisHint,
  type SourceTier,
} from "@radar-ia/analysis";

import { createAnalysisAttemptRepository } from "./analysis-attempt-repository.js";
import type { AnalysisAttemptRepository } from "./analysis-attempt-repository.js";
import {
  AnalysisOrchestrationError,
  type AnalysisOrchestrationErrorCode,
  type AnalysisOrchestrationInput,
  type AnalysisOrchestrationResult,
  type AnalysisOrchestrationSkipCode,
} from "./analysis-orchestration-types.js";
import { createNewsFolderRepository } from "./news-folder-repository.js";
import type { NewsFolderRepository } from "./news-folder-repository.js";
import type { NewsFolderArticle } from "./news-folder-types.js";
import { createNormalizedArticleRepository } from "./normalized-article-repository.js";
import type { NormalizedArticleRepository } from "./normalized-article-repository.js";

const SOURCE_TIERS: readonly SourceTier[] = ["S", "A", "B", "C", "D", "E"];

/**
 * Transaction boundaries (007.1E):
 * - Matching persistence (006) and analysis persistence (007) are decoupled.
 * - Ollama inference is never held inside a Prisma `$transaction`.
 * - A 007 failure must not roll back a valid 006 decision already committed.
 * - A 006 failure prevents analysis (caller must not invoke this orchestrator).
 * - Analysis writes remain append-only via 007.1B.
 */

export interface AnalysisOrchestrator {
  /**
   * Map 006 outcome → load aggregate → call 007.1D → typed result.
   * No Discord / Fastify; no matching recalculation.
   */
  process(input: AnalysisOrchestrationInput): Promise<AnalysisOrchestrationResult>;
}

export interface AnalysisOrchestratorOptions {
  /**
   * Injected analysis service (007.1D).
   * Required unless both `ollamaClient` and `expectedModelId` are provided.
   */
  analysisService?: AnalysisService;
  /** Used to build the default service when `analysisService` is omitted. */
  ollamaClient?: CreateAnalysisServiceDependencies["ollamaClient"];
  /** Tag modèle attendu (`OLLAMA_MODEL`) for the default service. */
  expectedModelId?: string;
  folderRepository?: NewsFolderRepository;
  articleRepository?: NormalizedArticleRepository;
  analysisAttemptRepository?: AnalysisAttemptRepository;
  clock?: AnalysisServiceClock;
  logger?: CreateAnalysisServiceDependencies["logger"];
  ollamaBaseUrl?: string;
}

function asSourceTier(value: string): SourceTier {
  if ((SOURCE_TIERS as readonly string[]).includes(value)) {
    return value as SourceTier;
  }
  throw new AnalysisOrchestrationError(
    `Invalid sourceTier on normalized article: ${JSON.stringify(value)}`,
  );
}

function parseEnrichmentFacts(json: unknown): EnrichmentFactInput[] {
  if (json === null || json === undefined) {
    return [];
  }
  if (typeof json !== "object" || Array.isArray(json)) {
    return [];
  }
  const facts = (json as { facts?: unknown }).facts;
  if (!Array.isArray(facts)) {
    return [];
  }

  const out: EnrichmentFactInput[] = [];
  for (const item of facts) {
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      const record = item as { key?: unknown; value?: unknown };
      if (
        typeof record.key === "string" &&
        typeof record.value === "string" &&
        record.key.trim().length > 0 &&
        record.value.trim().length > 0
      ) {
        out.push({ key: record.key, value: record.value });
      }
      continue;
    }
    if (typeof item === "string") {
      const sep = item.indexOf(":");
      if (sep > 0) {
        const key = item.slice(0, sep).trim();
        const value = item.slice(sep + 1).trim();
        if (key.length > 0 && value.length > 0) {
          out.push({ key, value });
        }
      }
    }
  }
  return out;
}

function collectFolderEnrichmentFacts(
  memberships: readonly NewsFolderArticle[],
): EnrichmentFactInput[] {
  const out: EnrichmentFactInput[] = [];
  const seen = new Set<string>();
  for (const membership of memberships) {
    if (membership.role !== "enrichment") {
      continue;
    }
    for (const fact of parseEnrichmentFacts(membership.enrichmentFacts)) {
      const dedupeKey = `${fact.key.trim().toLowerCase()}=${fact.value.trim().toLowerCase()}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      out.push(fact);
    }
  }
  return out;
}

function previousEnrichmentFactKeys(
  memberships: readonly NewsFolderArticle[],
  triggerArticleId: string | undefined,
): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const membership of memberships) {
    if (membership.role !== "enrichment") {
      continue;
    }
    if (
      triggerArticleId !== undefined &&
      membership.articleId === triggerArticleId
    ) {
      continue;
    }
    for (const fact of parseEnrichmentFacts(membership.enrichmentFacts)) {
      const key = fact.key.trim().toLowerCase();
      if (key.length === 0 || seen.has(key)) {
        continue;
      }
      seen.add(key);
      keys.push(fact.key);
    }
  }
  return keys;
}

function resolveTriggerEnrichmentType(
  memberships: readonly NewsFolderArticle[],
  input: AnalysisOrchestrationInput,
): string | null {
  if (input.triggerEnrichmentType !== undefined) {
    return input.triggerEnrichmentType;
  }
  if (input.articleId === undefined) {
    return null;
  }
  const membership = memberships.find(
    (row) => row.articleId === input.articleId,
  );
  return membership?.enrichmentType ?? null;
}

function toLastAcceptedHint(
  record: Awaited<
    ReturnType<AnalysisAttemptRepository["getLatestAcceptedAnalysis"]>
  >,
): LastAcceptedAnalysisHint | null {
  if (record === null) {
    return null;
  }
  if (record.backendScoring === null) {
    return null;
  }
  return {
    attemptId: record.id,
    aggregateFingerprint: record.aggregateFingerprint,
    bestSourceTier: record.backendScoring.bestSourceTier,
    publicationDecision: record.publicationDecision,
    analyzedAt: record.analyzedAt.toISOString(),
    validationStatus: record.validationStatus,
    ...(record.proposal ? { proposal: record.proposal } : {}),
    ...(record.backendScoring
      ? { backendScoring: record.backendScoring }
      : {}),
    warnings: record.warnings,
    droppedFacts: record.droppedFacts,
    ...(record.modelId ? { modelId: record.modelId } : {}),
  };
}

function mapServiceResult(
  matchingIssue: AnalysisOrchestrationInput["matchingIssue"],
  serviceResult: AnalysisServiceResult,
): AnalysisOrchestrationResult {
  switch (serviceResult.kind) {
    case "created":
      return {
        folderId: serviceResult.folderId,
        matchingIssue,
        status: "analyzed",
        attemptId: serviceResult.attemptId,
        aggregateFingerprint: serviceResult.aggregateFingerprint,
        publicationDecision: serviceResult.decision,
        channelHint: serviceResult.channelHint,
        analysis: serviceResult.analysis,
        skipCode: null,
        errorCodes: [],
        serviceResult,
      };
    case "reused":
      return {
        folderId: serviceResult.folderId,
        matchingIssue,
        status: "reused",
        attemptId: serviceResult.attemptId,
        aggregateFingerprint: serviceResult.aggregateFingerprint,
        publicationDecision: serviceResult.decision,
        channelHint: serviceResult.channelHint,
        analysis: serviceResult.analysis,
        skipCode: null,
        errorCodes: [],
        serviceResult,
      };
    case "skipped":
      return {
        folderId: serviceResult.folderId,
        matchingIssue,
        status: "skipped",
        attemptId: serviceResult.attemptId,
        aggregateFingerprint: serviceResult.aggregateFingerprint,
        publicationDecision: null,
        channelHint: null,
        analysis: null,
        skipCode: serviceResult.reason as AnalysisOrchestrationSkipCode,
        errorCodes: [],
        serviceResult,
      };
    case "failed":
      return {
        folderId: serviceResult.folderId,
        matchingIssue,
        status: "failed",
        attemptId: serviceResult.attemptId,
        aggregateFingerprint: serviceResult.aggregateFingerprint,
        publicationDecision: serviceResult.decision,
        channelHint: null,
        analysis: serviceResult.analysis,
        skipCode: null,
        errorCodes: [...serviceResult.errorCodes],
        serviceResult,
      };
    default: {
      const _exhaustive: never = serviceResult;
      throw new AnalysisOrchestrationError(
        `Unsupported analysis service result: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

function orchestrationSkip(input: {
  matchingIssue: AnalysisOrchestrationInput["matchingIssue"];
  folderId: string | null;
  skipCode: AnalysisOrchestrationSkipCode;
}): AnalysisOrchestrationResult {
  return {
    folderId: input.folderId,
    matchingIssue: input.matchingIssue,
    status: "skipped",
    attemptId: null,
    aggregateFingerprint: null,
    publicationDecision: null,
    channelHint: null,
    analysis: null,
    skipCode: input.skipCode,
    errorCodes: [],
    serviceResult: null,
  };
}

function orchestrationFail(input: {
  matchingIssue: AnalysisOrchestrationInput["matchingIssue"];
  folderId: string | null;
  errorCodes: readonly AnalysisOrchestrationErrorCode[];
}): AnalysisOrchestrationResult {
  return {
    folderId: input.folderId,
    matchingIssue: input.matchingIssue,
    status: "failed",
    attemptId: null,
    aggregateFingerprint: null,
    publicationDecision: null,
    channelHint: null,
    analysis: null,
    skipCode: null,
    errorCodes: [...input.errorCodes],
    serviceResult: null,
  };
}

function resolveAnalysisService(
  prisma: PrismaClient,
  options: AnalysisOrchestratorOptions,
  analysisAttemptRepository: AnalysisAttemptRepository,
): AnalysisService {
  if (options.analysisService) {
    return options.analysisService;
  }
  if (!options.ollamaClient || !options.expectedModelId) {
    throw new AnalysisOrchestrationError(
      "createAnalysisOrchestrator requires analysisService, or both ollamaClient and expectedModelId",
    );
  }
  return createAnalysisService({
    ollamaClient: options.ollamaClient,
    persistence: analysisAttemptRepository,
    expectedModelId: options.expectedModelId,
    clock: options.clock,
    logger: options.logger,
    ollamaBaseUrl: options.ollamaBaseUrl,
  });
}

/**
 * Factory for the analysis orchestrator (007.1E).
 * Minimal wiring: repositories → map 006 → `createAnalysisService` (007.1D).
 */
export function createAnalysisOrchestrator(
  prisma: PrismaClient,
  options: AnalysisOrchestratorOptions = {},
): AnalysisOrchestrator {
  const folderRepository =
    options.folderRepository ?? createNewsFolderRepository(prisma);
  const articleRepository =
    options.articleRepository ?? createNormalizedArticleRepository(prisma);
  const analysisAttemptRepository =
    options.analysisAttemptRepository ??
    createAnalysisAttemptRepository(prisma);
  const analysisService = resolveAnalysisService(
    prisma,
    options,
    analysisAttemptRepository,
  );

  return {
    async process(input) {
      const matchingIssue = input.matchingIssue;
      const hasMainPublication = input.hasMainPublication ?? false;

      // Issues non éligibles : short-circuit sans agrégat ni Ollama (gel §11.1).
      if (
        matchingIssue === "duplicate_editorial" ||
        matchingIssue === "ambiguous_no_action"
      ) {
        return orchestrationSkip({
          matchingIssue,
          folderId: input.folderId ?? null,
          skipCode: "not_eligible",
        });
      }

      if (
        matchingIssue !== "create_dossier" &&
        matchingIssue !== "attach_enrich"
      ) {
        const _exhaustive: never = matchingIssue;
        throw new AnalysisOrchestrationError(
          `Unsupported matching issue: ${JSON.stringify(_exhaustive)}`,
        );
      }

      const folderId = input.folderId ?? null;
      if (folderId === null || folderId.length === 0) {
        return orchestrationFail({
          matchingIssue,
          folderId: null,
          errorCodes: ["folder_id_required"],
        });
      }

      // Lectures hors transaction — jamais de verrou DB pendant Ollama.
      const folder = await folderRepository.getFolder(folderId);
      if (folder === null) {
        return orchestrationFail({
          matchingIssue,
          folderId,
          errorCodes: ["folder_not_found"],
        });
      }

      const memberships = await folderRepository.listFolderArticles(folderId);
      const articleIds = memberships.map((row) => row.articleId);
      const articles = await articleRepository.getNormalizedArticlesByIds(
        articleIds,
      );
      const articlesById = new Map(articles.map((row) => [row.id, row]));

      if (articlesById.size !== new Set(articleIds).size) {
        return orchestrationFail({
          matchingIssue,
          folderId,
          errorCodes: ["article_data_missing"],
        });
      }

      const analysisArticles: AnalysisArticleInput[] = memberships.map(
        (membership) => {
          const article = articlesById.get(membership.articleId)!;
          return {
            articleId: membership.articleId,
            role: membership.role,
            sourceId: article.sourceId,
            sourceTier: asSourceTier(article.sourceTier),
            title: article.title,
            url: article.url,
            summary: article.summary,
            content: article.content,
            attachedAt: membership.attachedAt,
            enrichmentType: membership.enrichmentType,
          };
        },
      );

      const primary = analysisArticles.find((row) => row.role === "primary");
      if (primary === undefined) {
        return orchestrationFail({
          matchingIssue,
          folderId,
          errorCodes: ["primary_article_missing"],
        });
      }

      const enrichmentFacts = collectFolderEnrichmentFacts(memberships);
      const lastAccepted = toLastAcceptedHint(
        await analysisAttemptRepository.getLatestAcceptedAnalysis(folderId),
      );

      // Appel 007.1D hors de toute transaction Prisma (inférence découplée).
      const serviceResult = await analysisService.analyze({
        folderId,
        folder: {
          id: folder.id,
          status: folder.status,
          title: folder.title,
        },
        articles: analysisArticles,
        enrichmentFacts,
        triggerIssue: matchingIssue,
        triggerEnrichmentType: resolveTriggerEnrichmentType(
          memberships,
          input,
        ),
        hasMainPublication,
        previousEnrichmentFactKeys: previousEnrichmentFactKeys(
          memberships,
          input.articleId,
        ),
        lastAcceptedAnalysis: lastAccepted,
        forceReanalysis: input.forceReanalysis,
      });

      return mapServiceResult(matchingIssue, serviceResult);
    },
  };
}
