import type { NormalizedArticle } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import {
  extractEventFingerprint,
  type MatchingArticleInput,
  type MatchingCandidateFolder,
  type MatchingSourceTier,
} from "@radar-ia/shared";

import {
  createPipelineLockRepository,
  type PipelineLockRepository,
} from "./administration-repository.js";
import { matchingResultToAnalysisInput } from "./analysis-orchestration-types.js";
import type { AnalysisOrchestrator } from "./analysis-orchestrator.js";
import { createAnalysisOrchestrator } from "./analysis-orchestrator.js";
import type { MatchingOrchestrator } from "./matching-orchestrator.js";
import { createMatchingOrchestrator } from "./matching-orchestrator.js";
import {
  createNewsFolderRepository,
  type NewsFolderRepository,
} from "./news-folder-repository.js";
import {
  createNormalizedArticleRepository,
  type NormalizedArticleRepository,
} from "./normalized-article-repository.js";
import type { PublicationOrchestrator } from "./publication-orchestrator.js";
import {
  createPublicationRepository,
  type PublicationRepository,
} from "./publication-repository.js";
import {
  createRawFeedRepository,
  type RawFeedRepository,
} from "./raw-feed-repository.js";
import {
  computeNextEligibleAt,
  DEFAULT_PIPELINE_HEARTBEAT_INTERVAL_MS,
  DEFAULT_PIPELINE_LOCK_TTL_MS,
  PipelineOrchestrationError,
  sanitizePipelineMessage,
  SOURCE_BACKOFF_DELAYS_MS,
  type PipelineAnalysisCounters,
  type PipelineAnalysisPort,
  type PipelineArticleCounters,
  type PipelineArticleNormalizer,
  type PipelineClock,
  type PipelineCollectResult,
  type PipelineCycleInput,
  type PipelineCycleRejectionCode,
  type PipelineCycleResult,
  type PipelineCycleSummary,
  type PipelineIncrementalCollector,
  type PipelineLogger,
  type PipelineMatchingCounters,
  type PipelineMatchingPort,
  type PipelineNormalizedError,
  type PipelineNormalizedErrorCode,
  type PipelinePublicationCounters,
  type PipelinePublicationPort,
  type PipelineSourceCounters,
  type PipelineSourceDefinition,
  type PipelineSourceFetchState,
  type PipelineSourceRegistryLoader,
} from "./pipeline-orchestration-types.js";
import type { PublicationOrchestrationInput } from "./publication-orchestration-types.js";
import type { FolderPublicationRecord } from "./publication-types.js";

export interface PipelineOrchestrator {
  runCycle(input: PipelineCycleInput): Promise<PipelineCycleResult>;
}

export interface PipelineOrchestratorOptions {
  /** Load source registry (file path resolved by the host). Required. */
  loadSourceRegistry: PipelineSourceRegistryLoader["load"] | PipelineSourceRegistryLoader;
  /** Incremental collector (004). Required. */
  collector: PipelineIncrementalCollector;
  /** Normalize feed items (004.1E). Required. */
  normalizeFeedArticles: PipelineArticleNormalizer["normalizeFeedArticles"];
  /** Publication orchestrator (008). Required when Discord work is expected. */
  publicationOrchestrator?: PublicationOrchestrator | PipelinePublicationPort;
  /** When false, collect/match/analyse continue; publish/resume are deferred. */
  isDiscordAvailable?: () => boolean | Promise<boolean>;
  matchingOrchestrator?: MatchingOrchestrator | PipelineMatchingPort;
  analysisOrchestrator?: AnalysisOrchestrator | PipelineAnalysisPort;
  lockRepository?: PipelineLockRepository;
  rawFeedRepository?: RawFeedRepository;
  articleRepository?: NormalizedArticleRepository;
  folderRepository?: NewsFolderRepository;
  publicationRepository?: PublicationRepository;
  clock?: PipelineClock;
  /** Absolute lock TTL from acquire/heartbeat. */
  lockTtlMs?: number;
  heartbeatIntervalMs?: number;
  backoffScheduleMs?: readonly number[];
  rawFeedRetentionPerSource?: number;
  rawFeedRetentionDays?: number;
  logger?: PipelineLogger;
  /** Optional heartbeat scheduler (defaults to setInterval). */
  setHeartbeatInterval?: (
    handler: () => void,
    ms: number,
  ) => { clear(): void };
}

const SOURCE_TIERS = new Set(["S", "A", "B", "C", "D", "E"]);

function emptySourceCounters(): PipelineSourceCounters {
  return {
    total: 0,
    enabled: 0,
    collected: 0,
    notModified: 0,
    skippedDisabled: 0,
    skippedBackoff: 0,
    failed: 0,
  };
}

function emptyArticleCounters(): PipelineArticleCounters {
  return {
    normalized: 0,
    rejected: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
  };
}

function emptyMatchingCounters(): PipelineMatchingCounters {
  return {
    create_dossier: 0,
    attach_enrich: 0,
    duplicate_editorial: 0,
    ambiguous_no_action: 0,
    failed: 0,
    skipped: 0,
  };
}

function emptyAnalysisCounters(): PipelineAnalysisCounters {
  return {
    analyzed: 0,
    reused: 0,
    skipped: 0,
    failed: 0,
  };
}

function emptyPublicationCounters(): PipelinePublicationCounters {
  return {
    published: 0,
    enriched: 0,
    resumed: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
  };
}

function resolveRegistryLoader(
  value: PipelineOrchestratorOptions["loadSourceRegistry"],
): () => Promise<import("./pipeline-orchestration-types.js").PipelineSourceRegistry> {
  if (typeof value === "function") {
    return value;
  }
  return () => value.load();
}

function toMatchingTier(tier: string): MatchingSourceTier {
  if (SOURCE_TIERS.has(tier)) {
    return tier as MatchingSourceTier;
  }
  return "E";
}

function articleToMatchingInput(article: NormalizedArticle): MatchingArticleInput {
  return {
    sourceId: article.sourceId,
    sourceTier: toMatchingTier(article.sourceTier),
    ...(article.externalId ? { externalId: article.externalId } : {}),
    title: article.title,
    url: article.url,
    ...(article.publishedAt
      ? { publishedAt: article.publishedAt.toISOString() }
      : {}),
    ...(article.summary ? { summary: article.summary } : {}),
    ...(article.content ? { content: article.content } : {}),
    categories: article.categories,
  };
}

function mergeFingerprints(
  base: ReturnType<typeof extractEventFingerprint>,
  extra: ReturnType<typeof extractEventFingerprint>,
): ReturnType<typeof extractEventFingerprint> {
  const knownFactKeys = [
    ...new Set([...base.knownFactKeys, ...extra.knownFactKeys]),
  ].sort();
  const categories = [...new Set([...base.categories, ...extra.categories])].sort();
  const canonicalUrls = [
    ...new Set([...base.canonicalUrls, ...extra.canonicalUrls]),
  ];
  const entities = [...new Set([...base.entities, ...extra.entities])];
  return {
    entities,
    productOrOrg: base.productOrOrg ?? extra.productOrOrg,
    announcementNature: base.announcementNature ?? extra.announcementNature,
    version: base.version ?? extra.version,
    knownFactKeys,
    categories,
    canonicalUrls,
    referenceDate: base.referenceDate ?? extra.referenceDate,
    bestSourceTier: base.bestSourceTier ?? extra.bestSourceTier,
  };
}

/**
 * Minimal candidate selection for 006 (009.1C): open/idle folders only,
 * fingerprints built from attached articles. No advanced search.
 */
export async function loadMatchingCandidateFolders(
  folderRepository: NewsFolderRepository,
  articleRepository: NormalizedArticleRepository,
): Promise<readonly MatchingCandidateFolder[]> {
  const folders = await folderRepository.listFoldersByStatuses(["open", "idle"], {
    take: 500,
  });
  const memberships = await folderRepository.listFolderArticlesByFolderIds(
    folders.map((folder) => folder.id),
  );
  const membershipsByFolder = new Map<string, typeof memberships>();
  for (const membership of memberships) {
    const current = membershipsByFolder.get(membership.folderId) ?? [];
    current.push(membership);
    membershipsByFolder.set(membership.folderId, current);
  }
  const articleIds = [...new Set(memberships.map((membership) => membership.articleId))];
  const articles = await articleRepository.getNormalizedArticlesByIds(articleIds);
  const articlesById = new Map(articles.map((article) => [article.id, article]));
  const candidates: MatchingCandidateFolder[] = [];

  for (const folder of folders) {
    const folderMemberships = membershipsByFolder.get(folder.id) ?? [];
    if (folderMemberships.length === 0) {
      candidates.push({
        id: folder.id,
        status: folder.status,
        title: folder.title,
        fingerprint: {
          entities: [],
          knownFactKeys: [],
          categories: [],
          canonicalUrls: [],
        },
      });
      continue;
    }

    const folderArticles = folderMemberships
      .map((membership) => articlesById.get(membership.articleId))
      .filter((article): article is NormalizedArticle => article !== undefined);
    if (folderArticles.length === 0) {
      candidates.push({
        id: folder.id,
        status: folder.status,
        title: folder.title,
        fingerprint: {
          entities: [],
          knownFactKeys: [],
          categories: [],
          canonicalUrls: [],
        },
      });
      continue;
    }

    let fingerprint = extractEventFingerprint(articleToMatchingInput(folderArticles[0]!));
    for (let i = 1; i < folderArticles.length; i += 1) {
      fingerprint = mergeFingerprints(
        fingerprint,
        extractEventFingerprint(articleToMatchingInput(folderArticles[i]!)),
      );
    }

    candidates.push({
      id: folder.id,
      status: folder.status,
      title: folder.title,
      fingerprint,
    });
  }

  return candidates;
}

function analysisToPublicationInput(
  analysis: import("./analysis-orchestration-types.js").AnalysisOrchestrationResult,
): PublicationOrchestrationInput | null {
  if (analysis.folderId === null || analysis.publicationDecision === null) {
    return null;
  }
  if (analysis.attemptId === null) {
    return null;
  }

  const decision = analysis.publicationDecision;
  const proposal = analysis.analysis?.proposal;
  const scoring = analysis.analysis?.backendScoring;
  const decisionMethod =
    analysis.analysis?.proposalOrigin === "deterministic_fallback"
      ? "deterministic_fallback"
      : "llm_analysis";

  const validatedContent =
    proposal !== undefined
      ? {
          summary: proposal.summary,
          primaryCategory: proposal.classification.primaryCategory,
          publishWorthiness: proposal.editorialProposal.publishWorthiness,
          composite: scoring?.composite ?? 0,
        }
      : null;

  const newFacts =
    proposal?.proposedFacts?.map((f) => ({
      key: f.key,
      value: f.value,
    })) ?? [];

  return {
    folderId: analysis.folderId,
    decision,
    analysisAttemptId: analysis.attemptId,
    channelHint: analysis.channelHint,
    aggregateFingerprint: analysis.aggregateFingerprint,
    validatedContent,
    sources: [],
    newFacts,
    newSources: [],
    decisionMethod,
  };
}

function mapAnalysisErrorCode(
  code: string,
): PipelineNormalizedErrorCode {
  switch (code) {
    case "ollama_unavailable":
    case "server_unreachable":
    case "http_error":
    case "model_absent":
      return "ollama_unavailable";
    case "inference_timeout":
    case "timeout":
      return "inference_timeout";
    case "invalid_json":
    case "empty_response":
      return "invalid_json";
    case "schema_violation":
    case "schema_validation":
      return "schema_violation";
    case "empty_summary":
      return "empty_summary";
    case "queue_timeout":
    case "lease_or_queue_timeout":
      return "queue_timeout";
    case "model_mismatch":
      return "model_mismatch";
    case "analysis_exhausted":
      return "analysis_exhausted";
    case "context_too_large":
      return "context_too_large";
    default:
      return "analysis_failed";
  }
}

function pushError(
  errors: PipelineNormalizedError[],
  entry: PipelineNormalizedError,
): void {
  if (errors.length >= 50) {
    return;
  }
  errors.push({
    ...entry,
    message: sanitizePipelineMessage(entry.message),
  });
}

function buildSummary(input: {
  degraded: boolean;
  rejectionCode: PipelineCycleRejectionCode | null;
  sources: PipelineSourceCounters;
  articles: PipelineArticleCounters;
  matching: PipelineMatchingCounters;
  analysis: PipelineAnalysisCounters;
  publication: PipelinePublicationCounters;
  errors: readonly PipelineNormalizedError[];
}): PipelineCycleSummary {
  return {
    version: 1,
    degraded: input.degraded,
    rejectionCode: input.rejectionCode,
    sources: input.sources,
    articles: input.articles,
    matching: input.matching,
    analysis: input.analysis,
    publication: input.publication,
    errorCodes: input.errors.map((e) => e.code),
  };
}

function decideFinalStatus(input: {
  rejectionCode: PipelineCycleRejectionCode | null;
  lockAcquired: boolean;
  degraded: boolean;
  sources: PipelineSourceCounters;
  fatal: boolean;
}): import("./administration-types.js").PipelineRunStatus | null {
  if (!input.lockAcquired) {
    return null;
  }
  if (input.fatal || input.rejectionCode === "registry_invalid") {
    return "failed";
  }
  if (
    input.rejectionCode === "persistence_unavailable" ||
    input.rejectionCode === "invariant_violated"
  ) {
    return "failed";
  }
  if (input.degraded) {
    return "degraded";
  }
  return "completed";
}

function defaultHeartbeatScheduler(
  handler: () => void,
  ms: number,
): { clear(): void } {
  const id = setInterval(handler, ms);
  return {
    clear() {
      clearInterval(id);
    },
  };
}

/**
 * Factory for the 009.1C exploitation-cycle orchestrator.
 * Composes 004–008 ports + 009.1B lock/run persistence. No worker / scheduler.
 */
export function createPipelineOrchestrator(
  prisma: PrismaClient,
  options: PipelineOrchestratorOptions,
): PipelineOrchestrator {
  if (options.collector === undefined) {
    throw new PipelineOrchestrationError("collector is required");
  }
  if (options.normalizeFeedArticles === undefined) {
    throw new PipelineOrchestrationError("normalizeFeedArticles is required");
  }
  if (options.loadSourceRegistry === undefined) {
    throw new PipelineOrchestrationError("loadSourceRegistry is required");
  }

  const clock: PipelineClock = options.clock ?? { now: () => new Date() };
  const lockTtlMs = options.lockTtlMs ?? DEFAULT_PIPELINE_LOCK_TTL_MS;
  const heartbeatIntervalMs =
    options.heartbeatIntervalMs ?? DEFAULT_PIPELINE_HEARTBEAT_INTERVAL_MS;
  const backoffSchedule = options.backoffScheduleMs ?? SOURCE_BACKOFF_DELAYS_MS;
  const loadRegistry = resolveRegistryLoader(options.loadSourceRegistry);
  const logger = options.logger;

  const lockRepository =
    options.lockRepository ?? createPipelineLockRepository(prisma);
  const rawFeedRepository =
    options.rawFeedRepository ?? createRawFeedRepository(prisma);
  const articleRepository =
    options.articleRepository ?? createNormalizedArticleRepository(prisma);
  const folderRepository =
    options.folderRepository ?? createNewsFolderRepository(prisma);
  const publicationRepository =
    options.publicationRepository ?? createPublicationRepository(prisma);

  const matchingOrchestrator: PipelineMatchingPort =
    options.matchingOrchestrator ?? createMatchingOrchestrator(prisma);
  const analysisOrchestrator: PipelineAnalysisPort =
    options.analysisOrchestrator ?? createAnalysisOrchestrator(prisma);
  const publicationOrchestrator = options.publicationOrchestrator;
  const scheduleHeartbeat =
    options.setHeartbeatInterval ?? defaultHeartbeatScheduler;

  async function runCycle(input: PipelineCycleInput): Promise<PipelineCycleResult> {
    const startedAt = clock.now();
    const sources = { ...emptySourceCounters() };
    const articles = { ...emptyArticleCounters() };
    const matching = { ...emptyMatchingCounters() };
    const analysis = { ...emptyAnalysisCounters() };
    const publication = { ...emptyPublicationCounters() };
    const errors: PipelineNormalizedError[] = [];

    let degraded = false;
    let rejectionCode: PipelineCycleRejectionCode | null = null;
    let lockAcquired = false;
    let lockStolen = false;
    let runId: string | null = null;
    let fatal = false;
    let lockLost = false;
    let heartbeat: { clear(): void } | null = null;
    let holderId = input.holderId;

    const markDegraded = (
      code: PipelineNormalizedErrorCode,
      message: string,
      extra?: Partial<PipelineNormalizedError>,
    ): void => {
      degraded = true;
      pushError(errors, { code, message, ...extra });
    };

    try {
      const expiresAt = new Date(startedAt.getTime() + lockTtlMs);
      let acquire;
      try {
        acquire = await lockRepository.tryAcquire({
          holderId: input.holderId,
          trigger: input.trigger,
          expiresAt,
          now: startedAt,
        });
      } catch (error) {
        rejectionCode = "persistence_unavailable";
        fatal = true;
        pushError(errors, {
          code: "persistence_unavailable",
          message:
            error instanceof Error
              ? error.message
              : "pipeline lock acquire failed",
        });
        return finalize({
          runId: null,
          status: "failed",
          lockAcquired: false,
          lockStolen: false,
          rejectionCode,
          degraded: false,
          fatal: true,
          startedAt,
          finishedAt: clock.now(),
          sources,
          articles,
          matching,
          analysis,
          publication,
          errors,
          trigger: input.trigger,
        });
      }

      if (acquire.kind === "blocked") {
        return finalize({
          runId: null,
          status: null,
          lockAcquired: false,
          lockStolen: false,
          rejectionCode: "concurrent_lock",
          degraded: false,
          fatal: false,
          startedAt,
          finishedAt: clock.now(),
          sources,
          articles,
          matching,
          analysis,
          publication,
          errors: [
            {
              code: "concurrent_lock",
              message: "pipeline cycle already active (single-flight)",
            },
          ],
          trigger: input.trigger,
        });
      }

      lockAcquired = true;
      lockStolen = acquire.stolen;
      runId = acquire.run.id;
      holderId = input.holderId;

      heartbeat = scheduleHeartbeat(() => {
        void (async () => {
          try {
            const now = clock.now();
            await lockRepository.heartbeat({
              holderId,
              expiresAt: new Date(now.getTime() + lockTtlMs),
              now,
            });
          } catch (error) {
            logger?.warn("pipeline heartbeat failed", {
              message:
                error instanceof Error ? error.message : "heartbeat failed",
            });
            markDegraded(
              "heartbeat_failed",
              error instanceof Error ? error.message : "heartbeat failed",
            );
            const code =
              error !== null &&
              typeof error === "object" &&
              "code" in error
                ? (error as { code?: unknown }).code
                : undefined;
            if (code === "lock_not_held" || code === "lock_holder_mismatch") {
              lockLost = true;
              fatal = true;
              markDegraded(
                "lock_lost",
                "pipeline lock was lost; cancelling remaining stages",
              );
            }
          }
        })();
      }, heartbeatIntervalMs);

      let registry;
      try {
        registry = await loadRegistry();
      } catch (error) {
        rejectionCode = "registry_invalid";
        fatal = true;
        const message =
          error instanceof Error
            ? error.message
            : "source registry unreadable";
        pushError(errors, {
          code: "registry_invalid",
          message,
        });
        logger?.warn("registry.invalid", {
          event: "registry.invalid",
          reason: sanitizePipelineMessage(message).slice(0, 500),
          action: "pipeline_aborted",
        });
        return await releaseAndFinalize({
          status: "failed",
          errorMessage: sanitizePipelineMessage(message),
        });
      }

      if (
        registry === null ||
        typeof registry !== "object" ||
        !Array.isArray(registry.sources)
      ) {
        rejectionCode = "registry_invalid";
        fatal = true;
        pushError(errors, {
          code: "registry_invalid",
          message: "source registry missing sources array",
        });
        return await releaseAndFinalize({
          status: "failed",
          errorMessage: "source registry missing sources array",
        });
      }

      sources.total = registry.sources.length;
      const enabledSources = registry.sources.filter((s) => s.enabled);
      sources.enabled = enabledSources.length;
      sources.skippedDisabled = sources.total - sources.enabled;

      const eligibleArticles: NormalizedArticle[] = [];

      for (const source of registry.sources) {
        if (lockLost) {
          break;
        }
        if (!source.enabled) {
          continue;
        }

        const now = clock.now();
        const state = await rawFeedRepository.getCollectedSourceState(source.id);
        if (
          state?.nextEligibleAt != null &&
          state.nextEligibleAt.getTime() > now.getTime()
        ) {
          sources.skippedBackoff += 1;
          continue;
        }

        try {
          const fetchState: PipelineSourceFetchState | undefined =
            state === null
              ? undefined
              : {
                  ...(state.etag ? { etag: state.etag } : {}),
                  ...(state.lastModified
                    ? { lastModified: state.lastModified }
                    : {}),
                };

          const collected = await options.collector.collect(source, fetchState);
          await handleCollectResult(source, collected, state, eligibleArticles);
        } catch (error) {
          sources.failed += 1;
          degraded = true;
          const failures = (state?.consecutiveFailures ?? 0) + 1;
          const nextEligibleAt = computeNextEligibleAt(
            failures,
            clock.now(),
            backoffSchedule,
          );
          try {
            await rawFeedRepository.recordSourceBackoff({
              sourceId: source.id,
              consecutiveFailures: failures,
              nextEligibleAt,
              lastCollectedAt: clock.now(),
            });
          } catch (backoffError) {
            markDegraded(
              "source_backoff_persist_failed",
              backoffError instanceof Error
                ? backoffError.message
                : "persist source backoff failed",
              { sourceId: source.id },
            );
            logger?.warn("source backoff persistence failed", {
              sourceId: source.id,
              message:
                backoffError instanceof Error
                  ? backoffError.message
                  : "persist source backoff failed",
            });
          }
          pushError(errors, {
            code: "source_collect_failed",
            message:
              error instanceof Error ? error.message : "source collect failed",
            sourceId: source.id,
          });
        }
      }

      if (lockLost) {
        return await releaseAndFinalize({
          status: "failed",
          errorMessage: "pipeline lock was lost",
        });
      }

      const candidates = await loadMatchingCandidateFolders(
        folderRepository,
        articleRepository,
      );

      for (const article of eligibleArticles) {
        if (lockLost) {
          break;
        }
        const membership = await folderRepository.getArticleMembership(
          article.id,
        );
        if (membership !== null) {
          matching.skipped += 1;
          logger?.info?.("matching.skipped", {
            event: "matching.skipped",
            articleId: article.id,
            sourceId: article.sourceId,
            reason: "already_processed",
            score: null,
            threshold: null,
          });
          continue;
        }
        const alreadyDecided =
          await folderRepository.hasMatchingDecisionForArticle(article.id);
        if (alreadyDecided) {
          matching.skipped += 1;
          logger?.info?.("matching.skipped", {
            event: "matching.skipped",
            articleId: article.id,
            sourceId: article.sourceId,
            reason: "terminal_state",
            score: null,
            threshold: null,
          });
          continue;
        }

        try {
          const matchResult = await matchingOrchestrator.process({
            articleId: article.id,
            article: articleToMatchingInput(article),
            candidateFolders: candidates,
            decidedAt: clock.now(),
          });
          matching[matchResult.proposal.issue] += 1;

          if (
            matchResult.proposal.issue === "duplicate_editorial" ||
            matchResult.proposal.issue === "ambiguous_no_action"
          ) {
            logger?.info?.("matching.skipped", {
              event: "matching.skipped",
              articleId: article.id,
              sourceId: article.sourceId,
              reason:
                matchResult.proposal.issue === "duplicate_editorial"
                  ? "duplicate"
                  : "below_threshold",
              score: matchResult.proposal.confidence,
              threshold: null,
              issue: matchResult.proposal.issue,
            });
            continue;
          }

          let hasMainPublication = false;
          const folderId =
            matchResult.persistence.folder?.id ??
            matchResult.proposal.folderId ??
            matchResult.persistence.decision.folderId;
          if (folderId !== null && folderId !== undefined) {
            const pub =
              await publicationRepository.getPublicationByFolder(folderId);
            hasMainPublication = pub?.hasMainPublication === true;
          }

          const analysisInput = matchingResultToAnalysisInput(matchResult, {
            hasMainPublication,
          });
          const analysisResult =
            await analysisOrchestrator.process(analysisInput);

          if (analysisResult.status === "analyzed") {
            analysis.analyzed += 1;
          } else if (analysisResult.status === "reused") {
            analysis.reused += 1;
          } else if (analysisResult.status === "skipped") {
            analysis.skipped += 1;
          } else {
            analysis.failed += 1;
            degraded = true;
            const failureDetail =
              analysisResult.serviceResult?.kind === "failed"
                ? analysisResult.serviceResult.failureDetail
                : undefined;
            const primaryCode =
              analysisResult.errorCodes[0] ??
              failureDetail?.errorCode ??
              "analysis_failed";
            const mappedCode = mapAnalysisErrorCode(primaryCode);
            const detailMessage =
              failureDetail?.message ??
              (analysisResult.errorCodes.join(",") || "analysis failed");
            pushError(errors, {
              code: mappedCode,
              message: detailMessage,
              folderId: analysisResult.folderId ?? undefined,
              articleId: article.id,
              sourceId: article.sourceId,
              stage: failureDetail?.stage,
              statusCode: failureDetail?.statusCode,
              errorCode: failureDetail?.errorCode ?? primaryCode,
              retryable: failureDetail?.retryable,
              attemptNumber: failureDetail?.attemptNumber,
              durationMs: failureDetail?.durationMs,
              model: failureDetail?.model,
            });
            logger?.warn("analysis.failed", {
              event: "analysis.failed",
              dossierId: analysisResult.folderId ?? null,
              articleIds: [article.id],
              sourceIds: [article.sourceId],
              stage: failureDetail?.stage ?? "unknown",
              model: failureDetail?.model ?? "unknown",
              statusCode: failureDetail?.statusCode ?? 0,
              errorCode: failureDetail?.errorCode ?? primaryCode,
              message: sanitizePipelineMessage(detailMessage).slice(0, 500),
              retryable: failureDetail?.retryable ?? true,
              attemptNumber: failureDetail?.attemptNumber ?? 0,
              durationMs: failureDetail?.durationMs ?? 0,
            });
          }

          await maybePublish(analysisResult);
        } catch (error) {
          matching.failed += 1;
          degraded = true;
          pushError(errors, {
            code: "matching_failed",
            message:
              error instanceof Error ? error.message : "matching failed",
            articleId: article.id,
          });
        }
      }

      if (lockLost) {
        return await releaseAndFinalize({
          status: "failed",
          errorMessage: "pipeline lock was lost",
        });
      }

      await resumePublications();
      if (lockLost) {
        return await releaseAndFinalize({
          status: "failed",
          errorMessage: "pipeline lock was lost",
        });
      }

      try {
        if (rawFeedRepository.purgeOldSnapshots === undefined) {
          return await releaseAndFinalize({
            status: decideFinalStatus({
              rejectionCode,
              lockAcquired: true,
              degraded,
              sources,
              fatal: false,
            }) ?? "completed",
            errorMessage: null,
          });
        }
        const olderThan =
          options.rawFeedRetentionDays === undefined
            ? undefined
            : new Date(
                clock.now().getTime() -
                  options.rawFeedRetentionDays * 24 * 60 * 60_000,
              );
        await rawFeedRepository.purgeOldSnapshots({
          keepPerSource: options.rawFeedRetentionPerSource ?? 20,
          olderThan,
        });
      } catch (error) {
        markDegraded(
          "raw_feed_purge_failed",
          error instanceof Error ? error.message : "raw feed purge failed",
        );
        logger?.warn("raw feed retention purge failed", {
          message: error instanceof Error ? error.message : "raw feed purge failed",
        });
      }

      const status = decideFinalStatus({
        rejectionCode,
        lockAcquired: true,
        degraded,
        sources,
        fatal: false,
      });

      return await releaseAndFinalize({
        status: status ?? "completed",
        errorMessage: null,
      });
    } catch (error) {
      fatal = true;
      rejectionCode = rejectionCode ?? "invariant_violated";
      pushError(errors, {
        code: "invariant_violated",
        message:
          error instanceof Error ? error.message : "pipeline invariant violated",
      });
      if (lockAcquired) {
        return await releaseAndFinalize({
          status: "failed",
          errorMessage: sanitizePipelineMessage(
            error instanceof Error
              ? error.message
              : "pipeline invariant violated",
          ),
        });
      }
      return finalize({
        runId,
        status: "failed",
        lockAcquired: false,
        lockStolen,
        rejectionCode,
        degraded: false,
        fatal: true,
        startedAt,
        finishedAt: clock.now(),
        sources,
        articles,
        matching,
        analysis,
        publication,
        errors,
        trigger: input.trigger,
      });
    } finally {
      heartbeat?.clear();
    }

    async function handleCollectResult(
      source: PipelineSourceDefinition,
      collected: PipelineCollectResult,
      priorState: Awaited<
        ReturnType<RawFeedRepository["getCollectedSourceState"]>
      >,
      eligible: NormalizedArticle[],
    ): Promise<void> {
      const now = clock.now();

      if (collected.status === "not-modified") {
        sources.notModified += 1;
        await rawFeedRepository.saveCollectedSourceState({
          sourceId: source.id,
          etag: collected.state.etag ?? priorState?.etag ?? null,
          lastModified:
            collected.state.lastModified ?? priorState?.lastModified ?? null,
          lastCollectedAt: now,
          lastHttpStatus: 304,
        });
        await rawFeedRepository.clearSourceBackoff(source.id);
        return;
      }

      sources.collected += 1;

      try {
        await rawFeedRepository.saveRawFeedSnapshot({
          sourceId: source.id,
          collectedAt: now,
          httpStatus: collected.httpStatus,
          etag: collected.state.etag ?? null,
          lastModified: collected.state.lastModified ?? null,
          feedFormat: collected.feed.format,
          rawBody: collected.rawBody,
          parseSucceeded: true,
        });

        await rawFeedRepository.saveCollectedSourceState({
          sourceId: source.id,
          etag: collected.state.etag ?? null,
          lastModified: collected.state.lastModified ?? null,
          lastCollectedAt: now,
          lastSuccessfulAt: now,
          lastHttpStatus: collected.httpStatus,
        });
        await rawFeedRepository.clearSourceBackoff(source.id);
      } catch (error) {
        markDegraded(
          "source_persist_failed",
          error instanceof Error ? error.message : "persist raw feed failed",
          { sourceId: source.id },
        );
        return;
      }

      const normalized = options.normalizeFeedArticles(source, collected.feed);
      articles.rejected += normalized.rejected.length;
      articles.normalized += normalized.articles.length;

      for (const rejected of normalized.rejected) {
        pushError(errors, {
          code: "normalize_rejected",
          message: rejected.reason,
          sourceId: source.id,
        });
      }

      for (const item of normalized.articles) {
        try {
          const persisted = await articleRepository.saveNormalizedArticle(item);
          if (persisted.outcome === "created") {
            articles.created += 1;
            eligible.push(persisted.article);
          } else if (persisted.outcome === "updated") {
            articles.updated += 1;
            eligible.push(persisted.article);
          } else {
            articles.unchanged += 1;
          }
        } catch (error) {
          markDegraded(
            "source_persist_failed",
            error instanceof Error
              ? error.message
              : "persist normalized article failed",
            { sourceId: source.id },
          );
        }
      }
    }

    async function maybePublish(
      analysisResult: import("./analysis-orchestration-types.js").AnalysisOrchestrationResult,
    ): Promise<void> {
      const pubInput = analysisToPublicationInput(analysisResult);
      if (pubInput === null) {
        return;
      }

      const discordOk = await resolveDiscordAvailable();
      if (!discordOk) {
        publication.deferred += 1;
        markDegraded("discord_unavailable", "Discord unavailable — publication deferred");
        return;
      }

      if (publicationOrchestrator === undefined) {
        publication.deferred += 1;
        markDegraded(
          "discord_unavailable",
          "publication orchestrator not configured — publication deferred",
        );
        return;
      }

      try {
        const result = await publicationOrchestrator.process(pubInput);
        applyPublicationResult(result, false);
      } catch (error) {
        publication.failed += 1;
        markDegraded(
          "publication_failed",
          error instanceof Error ? error.message : "publication failed",
          { folderId: pubInput.folderId },
        );
      }
    }

    async function resumePublications(): Promise<void> {
      let needing: FolderPublicationRecord[];
      try {
        needing = await publicationRepository.listPublicationsNeedingResume();
      } catch (error) {
        markDegraded(
          "publication_resume_failed",
          error instanceof Error
            ? error.message
            : "list publications needing resume failed",
        );
        return;
      }

      const discordOk = await resolveDiscordAvailable();
      if (!discordOk) {
        if (needing.length > 0) {
          publication.deferred += needing.length;
          markDegraded(
            "discord_unavailable",
            "Discord unavailable — publication resume deferred",
          );
        }
        return;
      }

      if (publicationOrchestrator === undefined) {
        if (needing.length > 0) {
          publication.deferred += needing.length;
          markDegraded(
            "discord_unavailable",
            "publication orchestrator not configured — resume deferred",
          );
        }
        return;
      }

      for (const pub of needing) {
        if (pub.status === "inconsistent") {
          publication.skipped += 1;
          continue;
        }
        try {
          const result = await publicationOrchestrator.resume(pub.folderId);
          applyPublicationResult(result, true);
        } catch (error) {
          publication.failed += 1;
          markDegraded(
            "publication_resume_failed",
            error instanceof Error
              ? error.message
              : "publication resume failed",
            { folderId: pub.folderId },
          );
        }
      }
    }

    function applyPublicationResult(
      result: import("./publication-orchestration-types.js").PublicationOrchestrationResult,
      fromResume: boolean,
    ): void {
      switch (result.kind) {
        case "succeeded":
          publication.published += 1;
          if (fromResume) publication.resumed += 1;
          break;
        case "enriched":
          publication.enriched += 1;
          if (fromResume) publication.resumed += 1;
          break;
        case "partial":
          publication.failed += 1;
          degraded = true;
          if (fromResume) {
            pushError(errors, {
              code: "publication_resume_failed",
              message: result.errorCode ?? "publication still partial",
              folderId: result.folderId,
            });
          } else {
            pushError(errors, {
              code: "publication_failed",
              message: result.errorCode ?? "publication partial",
              folderId: result.folderId,
            });
          }
          break;
        case "skipped":
          publication.skipped += 1;
          if (fromResume) publication.resumed += 1;
          break;
        case "failed":
          publication.failed += 1;
          degraded = true;
          pushError(errors, {
            code: fromResume
              ? "publication_resume_failed"
              : "publication_failed",
            message: result.error,
            folderId: result.folderId,
          });
          break;
        default: {
          const _exhaustive: never = result;
          void _exhaustive;
        }
      }
    }

    async function resolveDiscordAvailable(): Promise<boolean> {
      if (options.isDiscordAvailable === undefined) {
        return publicationOrchestrator !== undefined;
      }
      return options.isDiscordAvailable();
    }

    async function releaseAndFinalize(args: {
      status: import("./administration-types.js").PipelineRunStatus;
      errorMessage: string | null;
    }): Promise<PipelineCycleResult> {
      const finishedAt = clock.now();
      const summary = buildSummary({
        degraded,
        rejectionCode,
        sources,
        articles,
        matching,
        analysis,
        publication,
        errors,
      });

      try {
        await lockRepository.release({
          holderId,
          status: args.status === "running" ? "failed" : args.status,
          summary,
          errorMessage: args.errorMessage,
          finishedAt,
          now: finishedAt,
        });
      } catch (error) {
        markDegraded(
          "lock_release_failed",
          error instanceof Error ? error.message : "lock release failed",
        );
        logger?.warn("pipeline lock release failed", {
          message:
            error instanceof Error ? error.message : "lock release failed",
        });
      }

      return finalize({
        runId,
        status: args.status === "running" ? "failed" : args.status,
        lockAcquired: true,
        lockStolen,
        rejectionCode,
        degraded,
        fatal,
        startedAt,
        finishedAt,
        sources,
        articles,
        matching,
        analysis,
        publication,
        errors,
        trigger: input.trigger,
      });
    }
  }

  function finalize(args: {
    runId: string | null;
    status: import("./administration-types.js").PipelineRunStatus | null;
    lockAcquired: boolean;
    lockStolen: boolean;
    rejectionCode: PipelineCycleRejectionCode | null;
    degraded: boolean;
    fatal: boolean;
    startedAt: Date;
    finishedAt: Date;
    sources: PipelineSourceCounters;
    articles: PipelineArticleCounters;
    matching: PipelineMatchingCounters;
    analysis: PipelineAnalysisCounters;
    publication: PipelinePublicationCounters;
    errors: readonly PipelineNormalizedError[];
    trigger: import("./administration-types.js").PipelineRunTrigger;
  }): PipelineCycleResult {
    const summary = buildSummary({
      degraded: args.degraded,
      rejectionCode: args.rejectionCode,
      sources: args.sources,
      articles: args.articles,
      matching: args.matching,
      analysis: args.analysis,
      publication: args.publication,
      errors: args.errors,
    });

    return {
      runId: args.runId,
      status: args.status,
      trigger: args.trigger,
      startedAt: args.startedAt,
      finishedAt: args.finishedAt,
      lockAcquired: args.lockAcquired,
      lockStolen: args.lockStolen,
      rejectionCode: args.rejectionCode,
      degraded: args.degraded,
      sources: args.sources,
      articles: args.articles,
      matching: args.matching,
      analysis: args.analysis,
      publication: args.publication,
      errors: args.errors,
      summary,
    };
  }

  return { runCycle };
}
