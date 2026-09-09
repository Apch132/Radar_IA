import { createOllamaAnalysisClient } from "@radar-ia/analysis";
import {
  createDiscordPublicationAdapter,
  createPublicationChannelResolver,
} from "@radar-ia/bot/publication";
import {
  createSecureHttpClient,
  loadSourceRegistry,
} from "@radar-ia/collector";
import type { Config } from "@radar-ia/config";
import {
  createAnalysisOrchestrator,
  createInferenceLockRepository,
  createMatchingOrchestrator,
  createPipelineOrchestrator,
  createPrismaClient,
  createPublicationOrchestrator,
  type PipelineCycleResult,
  type PipelineOrchestrator,
} from "@radar-ia/database";

import type { WorkerDiscordHandle } from "./discord-runtime.js";
import type { WorkerLogger } from "./logger.js";
import { createPipelineCollectAdapters } from "./pipeline-collector.js";

type PrismaClient = ReturnType<typeof createPrismaClient>;

export type PipelineRuntime = {
  readonly prisma: PrismaClient;
  readonly orchestrator: PipelineOrchestrator;
  runCycle(input: {
    holderId: string;
    trigger: "scheduled" | "manual" | "cli";
  }): Promise<PipelineCycleResult>;
};

export type BuildPipelineRuntimeOptions = {
  readonly config: Config;
  readonly logger: WorkerLogger;
  readonly discord: WorkerDiscordHandle | null;
  /** Injectable Prisma (tests). */
  readonly prisma?: PrismaClient;
  /** Injectable orchestrator factory override (tests). */
  readonly createOrchestrator?: typeof createPipelineOrchestrator;
};

/**
 * Explicit composition of 004–008 behind `createPipelineOrchestrator`.
 * No editorial rules live here — only wiring.
 */
export function buildPipelineRuntime(
  options: BuildPipelineRuntimeOptions,
): PipelineRuntime {
  const { config, logger, discord } = options;
  const prisma =
    options.prisma ??
    createPrismaClient({ datasourceUrl: config.database.url });

  const httpClient = createSecureHttpClient();
  const { collector, normalizeFeedArticles } =
    createPipelineCollectAdapters(httpClient);

  const inferenceLocks = createInferenceLockRepository(prisma);
  const inferenceHolderId = `worker-ollama:${process.pid}`;

  const ollamaClient = createOllamaAnalysisClient({
    config: {
      baseUrl: config.ollama.baseUrl,
      model: config.ollama.model,
      maxConcurrency: 1,
    },
    acquireInferenceLease: async () => {
      const expiresAt = new Date(Date.now() + config.worker.lockTtlMs);
      const outcome = await inferenceLocks.tryAcquire({
        holderId: inferenceHolderId,
        expiresAt,
      });
      if (outcome.kind === "blocked") {
        throw new Error("ollama inference lock busy");
      }
      return async () => {
        await inferenceLocks.release({ holderId: inferenceHolderId });
      };
    },
  });

  const analysisOrchestrator = createAnalysisOrchestrator(prisma, {
    ollamaClient,
    expectedModelId: config.ollama.model,
    logger,
    ollamaBaseUrl: config.ollama.baseUrl,
  });

  const matchingOrchestrator = createMatchingOrchestrator(prisma);

  let publicationOrchestrator:
    | ReturnType<typeof createPublicationOrchestrator>
    | undefined;

  if (
    discord !== null &&
    config.discord.guildId !== undefined &&
    config.discord.token !== undefined
  ) {
    const discordPort = createDiscordPublicationAdapter(discord.client);
    publicationOrchestrator = createPublicationOrchestrator(prisma, {
      discordPort,
      resolveChannelId: createPublicationChannelResolver(config),
      guildId: config.discord.guildId,
      executionHolderId: `worker-pub:${process.pid}`,
      logger,
    });
  }

  const createOrchestrator =
    options.createOrchestrator ?? createPipelineOrchestrator;

  const orchestrator = createOrchestrator(prisma, {
    loadSourceRegistry: () =>
      loadSourceRegistry(config.sources.registryPath, {
        mode: "resilient",
        onInvalidSource: (report) => {
          logger.warn("registry.invalid_source", {
            event: "registry.invalid_source",
            sourceId: report.sourceId ?? "unknown",
            provider: report.provider ?? "unknown",
            reason: report.reason,
            action: report.action,
            index: report.index,
          });
        },
      }),
    collector,
    normalizeFeedArticles,
    matchingOrchestrator,
    analysisOrchestrator,
    publicationOrchestrator,
    isDiscordAvailable: () => discord?.isReady() ?? false,
    lockTtlMs: config.worker.lockTtlMs,
    heartbeatIntervalMs: config.worker.heartbeatIntervalMs,
    rawFeedRetentionPerSource: config.sources.rawFeedRetentionPerSource,
    rawFeedRetentionDays: config.sources.rawFeedRetentionDays,
    logger: {
      warn: (message, detail) => logger.warn(message, detail),
      info: (message, detail) => logger.info(message, detail),
    },
  });

  return {
    prisma,
    orchestrator,
    runCycle: (input) => orchestrator.runCycle(input),
  };
}
