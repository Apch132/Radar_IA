import { describe, expect, it, vi } from "vitest";

import {
  createPipelineLockRepository,
} from "./administration-repository.js";
import { PIPELINE_LOCK_ID } from "./administration-types.js";
import type { AnalysisOrchestrationResult } from "./analysis-orchestration-types.js";
import type { MatchingOrchestrationResult } from "./matching-orchestration-types.js";
import type { NewsFolderRepository } from "./news-folder-repository.js";
import type { NormalizedArticleRepository } from "./normalized-article-repository.js";
import {
  createPipelineOrchestrator,
  loadMatchingCandidateFolders,
} from "./pipeline-orchestrator.js";
import {
  computeNextEligibleAt,
  sanitizePipelineMessage,
  SOURCE_BACKOFF_DELAYS_MS,
  type PipelineCollectResult,
  type PipelineIncrementalCollector,
  type PipelineSourceDefinition,
  type PipelineSourceRegistry,
} from "./pipeline-orchestration-types.js";
import type { PublicationOrchestrationResult } from "./publication-orchestration-types.js";
import type { PublicationRepository } from "./publication-repository.js";
import type { RawFeedRepository } from "./raw-feed-repository.js";
import type { FolderPublicationRecord } from "./publication-types.js";

const SOURCE_A: PipelineSourceDefinition = {
  id: "src-a",
  name: "Source A",
  url: "https://example.com/feed-a.xml",
  tier: "A",
  enabled: true,
};

const SOURCE_B: PipelineSourceDefinition = {
  id: "src-b",
  name: "Source B",
  url: "https://example.com/feed-b.xml",
  tier: "B",
  enabled: true,
};

const SOURCE_DISABLED: PipelineSourceDefinition = {
  id: "src-off",
  name: "Disabled",
  url: "https://example.com/off.xml",
  tier: "C",
  enabled: false,
};

function articleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "art_1",
    sourceId: "src-a",
    sourceTier: "A",
    externalId: "ext-1",
    title: "OpenAI releases GPT-5",
    url: "https://example.com/gpt-5",
    publishedAt: new Date("2026-07-16T10:00:00.000Z"),
    updatedAt: null,
    author: null,
    summary: "GPT-5 is out",
    content: "OpenAI launches GPT-5 model.",
    categories: ["ai"],
    feedFormat: "rss",
    createdAt: new Date("2026-07-16T10:00:00.000Z"),
    persistedUpdatedAt: new Date("2026-07-16T10:00:00.000Z"),
    ...overrides,
  };
}

function createLockPrismaDouble() {
  const runs = new Map<string, Record<string, unknown>>();
  let runSeq = 0;
  let lock = {
    id: PIPELINE_LOCK_ID,
    runId: null as string | null,
    holderId: null as string | null,
    acquiredAt: null as Date | null,
    heartbeatAt: null as Date | null,
    expiresAt: null as Date | null,
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
          data: Partial<typeof lock>;
        }) => {
          if (where.id !== lock.id) throw new Error("lock not found");
          lock = { ...lock, ...data };
          return { ...lock };
        },
      ),
    },
    pipelineRun: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        runSeq += 1;
        const row = {
          id: `run_${runSeq}`,
          summary: null,
          errorMessage: null,
          finishedAt: null,
          createdAt: (data.startedAt as Date) ?? new Date(),
          updatedAt: (data.startedAt as Date) ?? new Date(),
          ...data,
        };
        runs.set(row.id as string, row);
        return { ...row };
      }),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const row = runs.get(where.id);
        return row === undefined ? null : { ...row };
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const row = runs.get(where.id);
          if (row === undefined) throw new Error("run not found");
          Object.assign(row, data, { updatedAt: new Date() });
          return { ...row };
        },
      ),
    },
    __runs: runs,
    __getLock: () => ({ ...lock }),
  };

  return prisma;
}

function createRawFeedRepoDouble(options: {
  states?: Map<string, Record<string, unknown>>;
} = {}): RawFeedRepository & {
  snapshots: unknown[];
  states: Map<string, Record<string, unknown>>;
} {
  const states = options.states ?? new Map<string, Record<string, unknown>>();
  const snapshots: unknown[] = [];

  return {
    snapshots,
    states,
    saveRawFeedSnapshot: vi.fn(async (input) => {
      snapshots.push(input);
      return { id: `snap_${snapshots.length}`, ...input } as never;
    }),
    saveCollectedSourceState: vi.fn(async (input) => {
      const prev = states.get(input.sourceId) ?? {
        sourceId: input.sourceId,
        consecutiveFailures: 0,
        nextEligibleAt: null,
      };
      const next = {
        ...prev,
        ...input,
        consecutiveFailures:
          input.consecutiveFailures ?? prev.consecutiveFailures ?? 0,
        nextEligibleAt:
          input.nextEligibleAt !== undefined
            ? input.nextEligibleAt
            : (prev.nextEligibleAt ?? null),
      };
      states.set(input.sourceId, next);
      return next as never;
    }),
    getCollectedSourceState: vi.fn(async (sourceId: string) => {
      const row = states.get(sourceId);
      return row === undefined ? null : ({ ...row } as never);
    }),
    listCollectedSourceStates: vi.fn(async () =>
      [...states.values()].map((row) => ({ ...row }) as never),
    ),
    listSourcesInBackoff: vi.fn(async () => []),
    recordSourceBackoff: vi.fn(async (input) => {
      const next = {
        sourceId: input.sourceId,
        consecutiveFailures: input.consecutiveFailures,
        nextEligibleAt: input.nextEligibleAt,
        lastCollectedAt: input.lastCollectedAt ?? null,
        lastHttpStatus: input.lastHttpStatus ?? null,
        etag: null,
        lastModified: null,
        lastSuccessfulAt: null,
      };
      states.set(input.sourceId, next);
      return next as never;
    }),
    clearSourceBackoff: vi.fn(async (sourceId: string) => {
      const prev = states.get(sourceId) ?? { sourceId };
      const next = {
        ...prev,
        consecutiveFailures: 0,
        nextEligibleAt: null,
      };
      states.set(sourceId, next);
      return next as never;
    }),
    purgeOldSnapshots: vi.fn(async () => 0),
  };
}

function createArticleRepoDouble(): NormalizedArticleRepository & {
  articles: Map<string, ReturnType<typeof articleRow>>;
} {
  const articles = new Map<string, ReturnType<typeof articleRow>>();
  let seq = 0;

  return {
    articles,
    saveNormalizedArticle: vi.fn(async (input) => {
      const existing = [...articles.values()].find((row) => {
        if (input.externalId) {
          return (
            row.sourceId === input.sourceId &&
            row.externalId === input.externalId
          );
        }
        return (
          row.sourceId === input.sourceId &&
          row.url === input.url &&
          row.externalId === null
        );
      });

      if (existing === undefined) {
        seq += 1;
        const row = articleRow({
          id: `art_${seq}`,
          ...input,
          publishedAt: input.publishedAt
            ? new Date(input.publishedAt)
            : null,
          updatedAt: input.updatedAt ? new Date(input.updatedAt) : null,
          author: input.author ?? null,
          summary: input.summary ?? null,
          content: input.content ?? null,
          categories: [...input.categories],
        });
        articles.set(row.id as string, row);
        return { outcome: "created" as const, article: row as never };
      }

      const same =
        existing.title === input.title &&
        existing.url === input.url &&
        existing.summary === (input.summary ?? null) &&
        existing.content === (input.content ?? null);

      if (same) {
        return { outcome: "unchanged" as const, article: existing as never };
      }

      Object.assign(existing, {
        title: input.title,
        url: input.url,
        summary: input.summary ?? null,
        content: input.content ?? null,
        categories: [...input.categories],
      });
      return { outcome: "updated" as const, article: existing as never };
    }),
    saveNormalizedArticles: vi.fn(async () => ({
      created: 0,
      updated: 0,
      unchanged: 0,
      articles: [],
    })),
    getNormalizedArticlesByIds: vi.fn(async (ids: readonly string[]) => {
      return ids
        .map((id) => articles.get(id))
        .filter(
          (row): row is ReturnType<typeof articleRow> => row !== undefined,
        ) as never;
    }),
  };
}

function createFolderRepoDouble(): NewsFolderRepository {
  return {
    createFolder: vi.fn(),
    attachArticle: vi.fn(),
    recordDecision: vi.fn(),
    updateFolder: vi.fn(),
    getFolder: vi.fn(async () => null),
    listFolderArticles: vi.fn(async () => []),
    listFolderArticlesByFolderIds: vi.fn(async () => []),
    listFoldersByStatuses: vi.fn(async () => []),
    getArticleMembership: vi.fn(async () => null),
    hasMatchingDecisionForArticle: vi.fn(async () => false),
    deleteFolder: vi.fn(),
  };
}

function createPublicationRepoDouble(
  needing: FolderPublicationRecord[] = [],
): PublicationRepository {
  return {
    getOrCreateFolderPublication: vi.fn(),
    reservePublish: vi.fn(),
    reserveOperation: vi.fn(),
    recordMainPublicationSuccess: vi.fn(),
    recordThreadCreated: vi.fn(),
    recordEnrichmentPublished: vi.fn(),
    recordFailure: vi.fn(),
    getPublicationByFolder: vi.fn(async () => null),
    listAttemptsForFolder: vi.fn(async () => []),
    findAttemptByIdempotencyKey: vi.fn(async () => null),
    findActiveAttemptByIdempotencyKey: vi.fn(async () => null),
    listRetryableAttempts: vi.fn(async () => []),
    listPublicationsNeedingResume: vi.fn(async () => needing),
  } as unknown as PublicationRepository;
}

function matchingResult(
  issue: MatchingOrchestrationResult["proposal"]["issue"],
  folderId = "fld_1",
): MatchingOrchestrationResult {
  return {
    proposal: {
      issue,
      folderId: issue === "ambiguous_no_action" ? null : folderId,
      confidence: "high",
      motiveCodes: [],
      favorableSignals: [],
      unfavorableSignals: [],
      enrichmentFacts:
        issue === "attach_enrich" ? [{ key: "k", value: "v" }] : null,
      enrichmentType: issue === "attach_enrich" ? "update" : null,
      folderTitle: issue === "create_dossier" ? "GPT-5" : null,
      justification: "test",
      proposalOrigin: "rule",
      reevaluable: true,
    },
    persistence: {
      decision: {
        id: "dec_1",
        issue,
        articleId: "art_1",
        folderId: issue === "ambiguous_no_action" ? null : folderId,
        confidence: "high",
        motiveCodes: [],
        favorableSignals: [],
        unfavorableSignals: [],
        enrichmentFacts: null,
        proposalOrigin: "rule",
        reevaluable: true,
        decidedAt: new Date(),
        createdAt: new Date(),
      } as never,
      folder:
        issue === "ambiguous_no_action"
          ? null
          : ({
              id: folderId,
              status: "open",
              title: "GPT-5",
              lastActivityAt: new Date(),
              closedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            } as never),
      membership: null,
    },
  };
}

function analysisResult(
  overrides: Partial<AnalysisOrchestrationResult> = {},
): AnalysisOrchestrationResult {
  return {
    folderId: "fld_1",
    matchingIssue: "create_dossier",
    status: "analyzed",
    attemptId: "aa_1",
    aggregateFingerprint: "fp_1",
    publicationDecision: "publish",
    channelHint: "veille_pertinente",
    analysis: {
      schemaVersion: "1",
      folderId: "fld_1",
      analyzedAt: "2026-07-16T10:00:00.000Z",
      modelId: "ministral",
      proposalOrigin: "llm",
      aggregateFingerprint: "fp_1",
      proposal: {
        schemaVersion: "1",
        summary: "OpenAI a annoncé GPT-5, un nouveau modèle majeur.",
        classification: {
          primaryCategory: "model_release",
          secondaryCategories: [],
          announcementNature: "launch",
        },
        scoring: {
          relevance: 80,
          impact: 80,
          novelty: 80,
          confidence: 80,
        },
        entities: ["OpenAI", "GPT-5"],
        proposedFacts: [{ key: "model", value: "GPT-5", support: "explicit" }],
        editorialProposal: {
          publishWorthiness: "medium",
          suggestedChannelRole: "veille_pertinente",
        },
        rationale: "Lancement produit clair.",
      },
      validation: { status: "accepted", warnings: [], droppedFacts: [] },
      backendScoring: {
        effectiveRelevance: 80,
        effectiveImpact: 80,
        composite: 75,
        bestSourceTier: "A",
        tierMultiplier: 1,
      },
    },
    skipCode: null,
    errorCodes: [],
    serviceResult: null,
    ...overrides,
  };
}

function updatedCollect(
  source: PipelineSourceDefinition = SOURCE_A,
): PipelineCollectResult {
  return {
    status: "updated",
    source,
    state: { etag: "etag-1", lastModified: "Wed, 01 Jan 2026 00:00:00 GMT" },
    httpStatus: 200,
    rawBody: "<rss></rss>",
    feed: {
      format: "rss",
      items: [
        {
          id: "ext-1",
          title: "OpenAI releases GPT-5",
          link: "https://example.com/gpt-5",
          publishedAt: "2026-07-16T10:00:00.000Z",
          summary: "GPT-5 is out",
          content: "OpenAI launches GPT-5 model.",
          categories: ["ai"],
        },
      ],
    },
  };
}

function createHarness(options: {
  registry?: PipelineSourceRegistry;
  collect?: PipelineIncrementalCollector["collect"];
  normalize?: ReturnType<typeof vi.fn>;
  matchingIssue?: MatchingOrchestrationResult["proposal"]["issue"];
  analysis?: AnalysisOrchestrationResult;
  publicationProcess?: PublicationOrchestrationResult;
  publicationResume?: PublicationOrchestrationResult;
  needingResume?: FolderPublicationRecord[];
  isDiscordAvailable?: () => boolean;
  rawStates?: Map<string, Record<string, unknown>>;
  clock?: { now: () => Date };
  heartbeatIntervalMs?: number;
  setHeartbeatInterval?: (
    handler: () => void,
    ms: number,
  ) => { clear(): void };
  logger?: { warn: ReturnType<typeof vi.fn>; info?: ReturnType<typeof vi.fn> };
} = {}) {
  const prisma = createLockPrismaDouble();
  const lockRepository = createPipelineLockRepository(prisma as never);
  const rawFeedRepository = createRawFeedRepoDouble({
    states: options.rawStates,
  });
  const articleRepository = createArticleRepoDouble();
  const folderRepository = createFolderRepoDouble();
  const publicationRepository = createPublicationRepoDouble(
    options.needingResume ?? [],
  );

  const matchingProcess = vi.fn(async () =>
    matchingResult(options.matchingIssue ?? "create_dossier"),
  );
  const analysisProcess = vi.fn(async () =>
    options.analysis ?? analysisResult(),
  );
  const publicationProcess = vi.fn(
    async () =>
      options.publicationProcess ??
      ({
        kind: "succeeded",
        folderId: "fld_1",
        mainMessageId: "msg_1",
        threadId: "thr_1",
        publication: { id: "pub_1" } as never,
        attempt: null,
        channelRole: "VEILLE_PERTINENTE",
      } satisfies PublicationOrchestrationResult),
  );
  const publicationResume = vi.fn(
    async () =>
      options.publicationResume ??
      ({
        kind: "succeeded",
        folderId: "fld_1",
        mainMessageId: "msg_1",
        threadId: "thr_1",
        publication: { id: "pub_1" } as never,
        attempt: null,
        channelRole: "VEILLE_PERTINENTE",
      } satisfies PublicationOrchestrationResult),
  );

  const collect = vi.fn(
    options.collect ??
      (async (source: PipelineSourceDefinition) => updatedCollect(source)),
  );

  const normalizeFeedArticles =
    options.normalize ??
    vi.fn(() => ({
      articles: [
        {
          sourceId: SOURCE_A.id,
          sourceTier: SOURCE_A.tier,
          externalId: "ext-1",
          title: "OpenAI releases GPT-5",
          url: "https://example.com/gpt-5",
          publishedAt: "2026-07-16T10:00:00.000Z",
          summary: "GPT-5 is out",
          content: "OpenAI launches GPT-5 model.",
          categories: ["ai"],
          feedFormat: "rss",
        },
      ],
      rejected: [],
    }));

  const nowMs = Date.parse("2026-07-16T12:00:00.000Z");
  const clock = options.clock ?? {
    now: () => new Date(nowMs),
  };

  const orchestrator = createPipelineOrchestrator(prisma as never, {
    loadSourceRegistry: async () =>
      options.registry ?? {
        sources: [SOURCE_A, SOURCE_DISABLED],
      },
    collector: { collect },
    normalizeFeedArticles,
    lockRepository,
    rawFeedRepository,
    articleRepository,
    folderRepository,
    publicationRepository,
    matchingOrchestrator: { process: matchingProcess },
    analysisOrchestrator: { process: analysisProcess },
    publicationOrchestrator: {
      process: publicationProcess,
      resume: publicationResume,
    },
    isDiscordAvailable: options.isDiscordAvailable ?? (() => true),
    clock,
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 60_000,
    setHeartbeatInterval: options.setHeartbeatInterval,
    lockTtlMs: 5 * 60_000,
    ...(options.logger ? { logger: options.logger } : {}),
  });

  return {
    orchestrator,
    prisma,
    lockRepository,
    rawFeedRepository,
    articleRepository,
    folderRepository,
    publicationRepository,
    collect,
    normalizeFeedArticles,
    matchingProcess,
    analysisProcess,
    publicationProcess,
    publicationResume,
    logger: options.logger,
  };
}

describe("createPipelineOrchestrator (009.1C)", () => {
  it("1. runs a nominal full cycle", async () => {
    const h = createHarness();
    const result = await h.orchestrator.runCycle({
      holderId: "worker-1",
      trigger: "manual",
    });

    expect(result.lockAcquired).toBe(true);
    expect(result.status).toBe("completed");
    expect(result.degraded).toBe(false);
    expect(result.sources.collected).toBe(1);
    expect(result.sources.skippedDisabled).toBe(1);
    expect(result.articles.created).toBe(1);
    expect(result.matching.create_dossier).toBe(1);
    expect(result.analysis.analyzed).toBe(1);
    expect(result.publication.published).toBe(1);
    expect(h.publicationProcess).toHaveBeenCalledOnce();
    expect(h.prisma.__getLock().holderId).toBeNull();
  });

  it("2. refuses concurrent single-flight", async () => {
    const prisma = createLockPrismaDouble();
    const lockRepo = createPipelineLockRepository(prisma as never);
    await lockRepo.tryAcquire({
      holderId: "worker-busy",
      trigger: "manual",
      expiresAt: new Date("2026-07-16T13:00:00.000Z"),
      now: new Date("2026-07-16T12:00:00.000Z"),
    });

    const blocked = createPipelineOrchestrator(prisma as never, {
      loadSourceRegistry: async () => ({ sources: [SOURCE_A] }),
      collector: { collect: vi.fn() },
      normalizeFeedArticles: vi.fn(() => ({ articles: [], rejected: [] })),
      lockRepository: lockRepo,
      rawFeedRepository: createRawFeedRepoDouble(),
      articleRepository: createArticleRepoDouble(),
      folderRepository: createFolderRepoDouble(),
      publicationRepository: createPublicationRepoDouble(),
      matchingOrchestrator: { process: vi.fn() },
      analysisOrchestrator: { process: vi.fn() },
      publicationOrchestrator: {
        process: vi.fn(),
        resume: vi.fn(),
      },
      clock: { now: () => new Date("2026-07-16T12:00:00.000Z") },
    });

    const result = await blocked.runCycle({
      holderId: "worker-2",
      trigger: "manual",
    });
    expect(result.lockAcquired).toBe(false);
    expect(result.rejectionCode).toBe("concurrent_lock");
    expect(result.status).toBeNull();
    expect(result.runId).toBeNull();
  });

  it("3. skips disabled sources", async () => {
    const h = createHarness({
      registry: { sources: [SOURCE_DISABLED] },
    });
    const result = await h.orchestrator.runCycle({
      holderId: "w",
      trigger: "cli",
    });
    expect(result.sources.skippedDisabled).toBe(1);
    expect(result.sources.enabled).toBe(0);
    expect(h.collect).not.toHaveBeenCalled();
    expect(result.status).toBe("completed");
  });

  it("4. skips sources in backoff", async () => {
    const states = new Map<string, Record<string, unknown>>([
      [
        SOURCE_A.id,
        {
          sourceId: SOURCE_A.id,
          consecutiveFailures: 2,
          nextEligibleAt: new Date("2026-07-16T15:00:00.000Z"),
        },
      ],
    ]);
    const h = createHarness({
      registry: { sources: [SOURCE_A] },
      rawStates: states,
    });
    const result = await h.orchestrator.runCycle({
      holderId: "w",
      trigger: "manual",
    });
    expect(result.sources.skippedBackoff).toBe(1);
    expect(h.collect).not.toHaveBeenCalled();
  });

  it("5. handles 304 not modified", async () => {
    const h = createHarness({
      registry: { sources: [SOURCE_A] },
      collect: async (source) => ({
        status: "not-modified",
        source,
        state: { etag: "etag-1" },
        httpStatus: 304,
      }),
    });
    const result = await h.orchestrator.runCycle({
      holderId: "w",
      trigger: "manual",
    });
    expect(result.sources.notModified).toBe(1);
    expect(result.articles.created).toBe(0);
    expect(h.matchingProcess).not.toHaveBeenCalled();
    expect(h.rawFeedRepository.clearSourceBackoff).toHaveBeenCalledWith(
      SOURCE_A.id,
    );
  });

  it("6. continues after one source failure", async () => {
    const h = createHarness({
      registry: { sources: [SOURCE_A, SOURCE_B] },
      collect: async (source) => {
        if (source.id === SOURCE_A.id) {
          throw new Error("HTTP 503");
        }
        return updatedCollect(source);
      },
      normalize: vi.fn((source: PipelineSourceDefinition) => ({
        articles: [
          {
            sourceId: source.id,
            sourceTier: source.tier,
            externalId: `ext-${source.id}`,
            title: "OpenAI releases GPT-5",
            url: `https://example.com/${source.id}`,
            categories: ["ai"],
            feedFormat: "rss",
            content: "OpenAI launches GPT-5 model.",
          },
        ],
        rejected: [],
      })),
    });
    const result = await h.orchestrator.runCycle({
      holderId: "w",
      trigger: "manual",
    });
    expect(result.sources.failed).toBe(1);
    expect(result.sources.collected).toBe(1);
    expect(result.status).toBe("degraded");
    expect(result.degraded).toBe(true);
    expect(h.rawFeedRepository.recordSourceBackoff).toHaveBeenCalled();
  });

  it("7. records partial normalize rejections", async () => {
    const h = createHarness({
      registry: { sources: [SOURCE_A] },
      normalize: vi.fn(() => ({
        articles: [
          {
            sourceId: SOURCE_A.id,
            sourceTier: "A",
            externalId: "ext-1",
            title: "Ok article",
            url: "https://example.com/ok",
            categories: [],
            feedFormat: "rss",
          },
        ],
        rejected: [{ reason: "missing title", category: "invalid" }],
      })),
    });
    const result = await h.orchestrator.runCycle({
      holderId: "w",
      trigger: "manual",
    });
    expect(result.articles.rejected).toBe(1);
    expect(result.articles.created).toBe(1);
    expect(result.errors.some((e) => e.code === "normalize_rejected")).toBe(
      true,
    );
  });

  it("8. created article → matching → analysis → publication", async () => {
    const h = createHarness({ matchingIssue: "create_dossier" });
    const result = await h.orchestrator.runCycle({
      holderId: "w",
      trigger: "manual",
    });
    expect(h.matchingProcess).toHaveBeenCalledOnce();
    expect(h.analysisProcess).toHaveBeenCalledOnce();
    expect(h.publicationProcess).toHaveBeenCalledOnce();
    expect(result.matching.create_dossier).toBe(1);
    expect(result.analysis.analyzed).toBe(1);
    expect(result.publication.published).toBe(1);
  });

  it("9. duplicate_editorial skips analysis", async () => {
    const h = createHarness({ matchingIssue: "duplicate_editorial" });
    const result = await h.orchestrator.runCycle({
      holderId: "w",
      trigger: "manual",
    });
    expect(result.matching.duplicate_editorial).toBe(1);
    expect(h.analysisProcess).not.toHaveBeenCalled();
    expect(h.publicationProcess).not.toHaveBeenCalled();
  });

  it("10. ambiguous_no_action skips automatic action", async () => {
    const h = createHarness({ matchingIssue: "ambiguous_no_action" });
    const result = await h.orchestrator.runCycle({
      holderId: "w",
      trigger: "manual",
    });
    expect(result.matching.ambiguous_no_action).toBe(1);
    expect(h.analysisProcess).not.toHaveBeenCalled();
    expect(h.publicationProcess).not.toHaveBeenCalled();
  });

  it("11. Ollama unavailable → degraded cycle with analysis.failed detail", async () => {
    const warn = vi.fn();
    const h = createHarness({
      logger: { warn },
      analysis: analysisResult({
        status: "failed",
        publicationDecision: null,
        channelHint: null,
        analysis: null,
        errorCodes: ["ollama_unavailable"],
        serviceResult: {
          kind: "failed",
          attemptId: "att_fail",
          folderId: "fld_1",
          aggregateFingerprint: "fp_1",
          decision: "hold",
          errorCodes: ["ollama_unavailable"],
          analysis: {
            schemaVersion: "1",
            folderId: "fld_1",
            analyzedAt: "2026-07-16T10:00:00.000Z",
            modelId: "ministral-3:3b",
            proposalOrigin: "llm_analysis",
            aggregateFingerprint: "fp_1",
            validation: {
              status: "rejected",
              warnings: [],
              droppedFacts: [],
            },
          },
          attemptNumber: 1,
          failureDetail: {
            stage: "transport",
            errorCode: "server_unreachable",
            message: "fetch failed: ECONNREFUSED",
            statusCode: 0,
            retryable: true,
            attemptNumber: 1,
            durationMs: 12,
            model: "ministral-3:3b",
            ollamaBaseUrl: "http://127.0.0.1:11434",
          },
        },
      }),
    });
    const result = await h.orchestrator.runCycle({
      holderId: "w",
      trigger: "manual",
    });
    expect(result.status).toBe("degraded");
    expect(result.analysis.failed).toBe(1);
    expect(result.errors.some((e) => e.code === "ollama_unavailable")).toBe(
      true,
    );
    const analysisError = result.errors.find(
      (e) => e.code === "ollama_unavailable",
    );
    expect(analysisError?.stage).toBe("transport");
    expect(analysisError?.errorCode).toBe("server_unreachable");
    expect(analysisError?.message).toMatch(/ECONNREFUSED/);
    expect(analysisError?.model).toBe("ministral-3:3b");
    expect(warn).toHaveBeenCalledWith(
      "analysis.failed",
      expect.objectContaining({
        event: "analysis.failed",
        stage: "transport",
        model: "ministral-3:3b",
        errorCode: "server_unreachable",
        message: expect.stringMatching(/ECONNREFUSED/),
        retryable: true,
      }),
    );
  });

  it("12. Discord unavailable → deferred publication, degraded", async () => {
    const h = createHarness({ isDiscordAvailable: () => false });
    const result = await h.orchestrator.runCycle({
      holderId: "w",
      trigger: "manual",
    });
    expect(result.status).toBe("degraded");
    expect(result.publication.deferred).toBeGreaterThanOrEqual(1);
    expect(h.publicationProcess).not.toHaveBeenCalled();
    expect(result.errors.some((e) => e.code === "discord_unavailable")).toBe(
      true,
    );
  });

  it("13. resumes partial publication successfully", async () => {
    const needing = [
      {
        id: "pub_partial",
        folderId: "fld_partial",
        status: "partial",
        guildId: "g",
        channelId: "c",
        mainMessageId: "m",
        threadId: null,
        sourceAnalysisAttemptId: null,
        lastErrorCode: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        lastActivityAt: new Date(),
        hasMainPublication: true,
      } satisfies FolderPublicationRecord,
    ];
    const h = createHarness({
      registry: { sources: [] },
      needingResume: needing,
      publicationResume: {
        kind: "succeeded",
        folderId: "fld_partial",
        mainMessageId: "m",
        threadId: "t",
        publication: needing[0]!,
        attempt: null,
        channelRole: "VEILLE_PERTINENTE",
      },
    });
    const result = await h.orchestrator.runCycle({
      holderId: "w",
      trigger: "manual",
    });
    expect(h.publicationResume).toHaveBeenCalledWith("fld_partial");
    expect(result.publication.resumed).toBe(1);
    expect(result.publication.published).toBe(1);
  });

  it("14. does not auto-resume inconsistent", async () => {
    const needing = [
      {
        id: "pub_bad",
        folderId: "fld_bad",
        status: "inconsistent",
        guildId: "g",
        channelId: "c",
        mainMessageId: "m",
        threadId: null,
        sourceAnalysisAttemptId: null,
        lastErrorCode: "inconsistent_state",
        createdAt: new Date(),
        updatedAt: new Date(),
        lastActivityAt: new Date(),
        hasMainPublication: true,
      } satisfies FolderPublicationRecord,
    ];
    const h = createHarness({
      registry: { sources: [] },
      needingResume: needing,
    });
    const result = await h.orchestrator.runCycle({
      holderId: "w",
      trigger: "manual",
    });
    expect(h.publicationResume).not.toHaveBeenCalled();
    expect(result.publication.skipped).toBe(1);
  });

  it("15. heartbeats the lock during the cycle", async () => {
    const heartbeatCalls: Array<() => void> = [];
    const h = createHarness({
      heartbeatIntervalMs: 10,
      setHeartbeatInterval: (handler) => {
        heartbeatCalls.push(handler);
        return { clear: vi.fn() };
      },
    });
    const heartbeatSpy = vi.spyOn(h.lockRepository, "heartbeat");
    await h.orchestrator.runCycle({ holderId: "w", trigger: "manual" });
    expect(heartbeatCalls.length).toBe(1);
    heartbeatCalls[0]!();
    await Promise.resolve();
    await Promise.resolve();
    expect(heartbeatSpy).toHaveBeenCalled();
  });

  it("16. releases the lock after success", async () => {
    const h = createHarness();
    await h.orchestrator.runCycle({ holderId: "w", trigger: "manual" });
    expect(h.prisma.__getLock().holderId).toBeNull();
    expect(h.prisma.__getLock().runId).toBeNull();
  });

  it("17. releases the lock after failure", async () => {
    const prisma = createLockPrismaDouble();
    const lockRepository = createPipelineLockRepository(prisma as never);
    const orchestrator = createPipelineOrchestrator(prisma as never, {
      loadSourceRegistry: async () => {
        throw new Error("invalid registry JSON");
      },
      collector: { collect: vi.fn() },
      normalizeFeedArticles: vi.fn(() => ({ articles: [], rejected: [] })),
      lockRepository,
      rawFeedRepository: createRawFeedRepoDouble(),
      articleRepository: createArticleRepoDouble(),
      folderRepository: createFolderRepoDouble(),
      publicationRepository: createPublicationRepoDouble(),
      matchingOrchestrator: { process: vi.fn() },
      analysisOrchestrator: { process: vi.fn() },
      publicationOrchestrator: { process: vi.fn(), resume: vi.fn() },
      clock: { now: () => new Date("2026-07-16T12:00:00.000Z") },
    });

    const result = await orchestrator.runCycle({
      holderId: "w",
      trigger: "manual",
    });
    expect(result.status).toBe("failed");
    expect(result.rejectionCode).toBe("registry_invalid");
    expect(prisma.__getLock().holderId).toBeNull();
  });

  it("18. status completed", async () => {
    const h = createHarness({ registry: { sources: [] } });
    const result = await h.orchestrator.runCycle({
      holderId: "w",
      trigger: "manual",
    });
    expect(result.status).toBe("completed");
    expect(result.degraded).toBe(false);
  });

  it("19. status degraded", async () => {
    const h = createHarness({ isDiscordAvailable: () => false });
    const result = await h.orchestrator.runCycle({
      holderId: "w",
      trigger: "manual",
    });
    expect(result.status).toBe("degraded");
  });

  it("20. status failed", async () => {
    const prisma = createLockPrismaDouble();
    const orchestrator = createPipelineOrchestrator(prisma as never, {
      loadSourceRegistry: async () => {
        throw new Error("boom");
      },
      collector: { collect: vi.fn() },
      normalizeFeedArticles: vi.fn(() => ({ articles: [], rejected: [] })),
      lockRepository: createPipelineLockRepository(prisma as never),
      rawFeedRepository: createRawFeedRepoDouble(),
      articleRepository: createArticleRepoDouble(),
      folderRepository: createFolderRepoDouble(),
      publicationRepository: createPublicationRepoDouble(),
      matchingOrchestrator: { process: vi.fn() },
      analysisOrchestrator: { process: vi.fn() },
      publicationOrchestrator: { process: vi.fn(), resume: vi.fn() },
      clock: { now: () => new Date("2026-07-16T12:00:00.000Z") },
    });
    const result = await orchestrator.runCycle({
      holderId: "w",
      trigger: "cli",
    });
    expect(result.status).toBe("failed");
  });

  it("21. second cycle without new data is idempotent", async () => {
    const h = createHarness({ registry: { sources: [SOURCE_A] } });
    const first = await h.orchestrator.runCycle({
      holderId: "w",
      trigger: "manual",
    });
    expect(first.articles.created).toBe(1);
    expect(first.matching.create_dossier).toBe(1);

    h.folderRepository.hasMatchingDecisionForArticle = vi.fn(async () => true);

    const second = await h.orchestrator.runCycle({
      holderId: "w",
      trigger: "manual",
    });
    expect(second.articles.unchanged).toBe(1);
    expect(second.matching.create_dossier).toBe(0);
    expect(h.matchingProcess).toHaveBeenCalledTimes(1); // only first cycle
    expect(second.status).toBe("completed");
  });

  it("uses a deterministic fallback publish once after an Ollama failure", async () => {
    const fallback = analysisResult({
      analysis: {
        ...analysisResult().analysis!,
        modelId: "deterministic_fallback",
        proposalOrigin: "deterministic_fallback",
      },
    });
    const h = createHarness({ analysis: fallback });
    await h.orchestrator.runCycle({ holderId: "w", trigger: "manual" });
    expect(h.analysisProcess).toHaveBeenCalledOnce();
    expect(h.publicationProcess).toHaveBeenCalledOnce();
    expect(h.publicationProcess.mock.calls[0]![0]).toMatchObject({
      decision: "publish",
      decisionMethod: "deterministic_fallback",
    });

    h.folderRepository.hasMatchingDecisionForArticle = vi.fn(async () => true);
    await h.orchestrator.runCycle({ holderId: "w", trigger: "manual" });
    expect(h.publicationProcess).toHaveBeenCalledOnce();
  });

  it("22. counters and summary are deterministic", async () => {
    const h = createHarness();
    const a = await h.orchestrator.runCycle({
      holderId: "w",
      trigger: "manual",
    });
    const h2 = createHarness();
    const b = await h2.orchestrator.runCycle({
      holderId: "w",
      trigger: "manual",
    });
    expect(a.summary).toEqual(b.summary);
    expect(a.sources).toEqual(b.sources);
    expect(a.articles).toEqual(b.articles);
    expect(a.matching).toEqual(b.matching);
  });

  it("23. never leaks secrets in errors / result", async () => {
    const prisma = createLockPrismaDouble();
    const orchestrator = createPipelineOrchestrator(prisma as never, {
      loadSourceRegistry: async () => {
        throw new Error(
          "connect postgresql://user:secret@localhost/db DATABASE_URL=postgres://x Bearer tokensk-abc",
        );
      },
      collector: { collect: vi.fn() },
      normalizeFeedArticles: vi.fn(() => ({ articles: [], rejected: [] })),
      lockRepository: createPipelineLockRepository(prisma as never),
      rawFeedRepository: createRawFeedRepoDouble(),
      articleRepository: createArticleRepoDouble(),
      folderRepository: createFolderRepoDouble(),
      publicationRepository: createPublicationRepoDouble(),
      matchingOrchestrator: { process: vi.fn() },
      analysisOrchestrator: { process: vi.fn() },
      publicationOrchestrator: { process: vi.fn(), resume: vi.fn() },
      clock: { now: () => new Date("2026-07-16T12:00:00.000Z") },
    });
    const result = await orchestrator.runCycle({
      holderId: "w",
      trigger: "manual",
    });
    const blob = JSON.stringify(result);
    expect(blob).not.toMatch(/secret@/);
    expect(blob).not.toMatch(/Bearer\s+token/i);
    expect(blob).not.toMatch(/sk-abc/);
    expect(blob).toContain("[redacted]");
  });

  it("24. package boundaries: no discord.js import in pipeline module", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const dir = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(
      path.join(dir, "pipeline-orchestrator.ts"),
      "utf8",
    );
    const types = fs.readFileSync(
      path.join(dir, "pipeline-orchestration-types.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/discord\.js/);
    expect(types).not.toMatch(/discord\.js/);
    expect(src).not.toMatch(/process\.env/);
  });
});

describe("Correctif 2 golden pipeline (collect → match → analyse → publish)", () => {
  const OPENAI: PipelineSourceDefinition = {
    id: "openai-news",
    name: "OpenAI News",
    url: "https://openai.com/news/rss.xml",
    tier: "S",
    enabled: true,
    provider: "rss",
  };

  it("publishes a major GPT announcement exactly once via Discord mock", async () => {
    const h = createHarness({
      registry: { sources: [OPENAI] },
      collect: async (source) =>
        updatedCollect({
          ...source,
          id: OPENAI.id,
          name: OPENAI.name,
          url: OPENAI.url,
          tier: OPENAI.tier,
          enabled: true,
          provider: "rss",
        }),
      matchingIssue: "create_dossier",
      analysis: analysisResult({
        publicationDecision: "publish",
        channelHint: "annonces_majeures",
      }),
      publicationProcess: {
        kind: "succeeded",
        folderId: "fld_1",
        mainMessageId: "msg_gpt5",
        threadId: "thr_gpt5",
        publication: { id: "pub_gpt5" } as never,
        attempt: null,
        channelRole: "ANNONCES_MAJEURES",
      },
    });

    const result = await h.orchestrator.runCycle({
      holderId: "golden-worker",
      trigger: "manual",
    });

    expect(result.status).toBe("completed");
    expect(result.matching.create_dossier).toBe(1);
    expect(result.analysis.analyzed).toBe(1);
    expect(result.publication.published).toBe(1);
    expect(h.publicationProcess).toHaveBeenCalledOnce();
  });

  it("Ollama unavailable → analysis failed path does not double-publish", async () => {
    const h = createHarness({
      registry: { sources: [OPENAI] },
      collect: async (source) => updatedCollect(source),
      matchingIssue: "create_dossier",
      analysis: analysisResult({
        status: "failed",
        publicationDecision: null,
        channelHint: null,
        analysis: null,
        errorCodes: ["ollama_unavailable"],
      }),
    });

    const result = await h.orchestrator.runCycle({
      holderId: "golden-worker",
      trigger: "manual",
    });

    expect(result.analysis.failed).toBeGreaterThanOrEqual(1);
    expect(h.publicationProcess).not.toHaveBeenCalled();
  });
});

describe("pipeline helpers", () => {
  it("computes progressive source backoff", () => {
    const now = new Date("2026-07-16T12:00:00.000Z");
    expect(computeNextEligibleAt(1, now).getTime()).toBe(
      now.getTime() + SOURCE_BACKOFF_DELAYS_MS[0],
    );
    expect(computeNextEligibleAt(99, now).getTime()).toBe(
      now.getTime() +
        SOURCE_BACKOFF_DELAYS_MS[SOURCE_BACKOFF_DELAYS_MS.length - 1]!,
    );
  });

  it("sanitizePipelineMessage redacts credentials", () => {
    expect(
      sanitizePipelineMessage("url=postgresql://u:p@h/db Bearer abc sk-xyz"),
    ).toContain("[redacted]");
  });

  it("loadMatchingCandidateFolders builds fingerprints from open/idle only", async () => {
    const articleRepository = createArticleRepoDouble();
    const art = articleRow({ id: "art_x" });
    articleRepository.articles.set("art_x", art);

    const folderRepository: NewsFolderRepository = {
      ...createFolderRepoDouble(),
      listFoldersByStatuses: vi.fn(async (statuses) => {
        expect(statuses).toEqual(["open", "idle"]);
        return [
          {
            id: "fld_open",
            status: "open",
            title: "Open dossier",
            lastActivityAt: new Date(),
            closedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ] as never;
      }),
      listFolderArticlesByFolderIds: vi.fn(async () =>
        [
          {
            id: "m1",
            folderId: "fld_open",
            articleId: "art_x",
            role: "primary",
            enrichmentType: null,
            enrichmentFacts: null,
            attachedAt: new Date(),
          },
        ] as never,
      ),
      listFolderArticles: vi.fn(async () =>
        [
          {
            id: "m1",
            folderId: "fld_open",
            articleId: "art_x",
            role: "primary",
            enrichmentType: null,
            enrichmentFacts: null,
            attachedAt: new Date(),
          },
        ] as never,
      ),
    };

    const candidates = await loadMatchingCandidateFolders(
      folderRepository,
      articleRepository,
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.id).toBe("fld_open");
    expect(candidates[0]!.fingerprint.canonicalUrls.length).toBeGreaterThan(0);
  });
});
