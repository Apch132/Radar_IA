import { createOllamaAnalysisClient } from "@radar-ia/analysis";
import {
  createSecureHttpClient,
  loadSourceRegistry,
} from "@radar-ia/collector";
import type { Config } from "@radar-ia/config";
import {
  createAdminOpsService,
  createAnalysisOrchestrator,
  createInferenceLockRepository,
  createMatchingOrchestrator,
  createPipelineOrchestrator,
  createPrismaClient,
  createPublicationOrchestrator,
  type AdminOpsService,
  type PipelineOrchestrator,
} from "@radar-ia/database";
import type { Client } from "discord.js";

import { createDiscordPublicationAdapter } from "../publication/discord-publication-adapter.js";
import { createPublicationChannelResolver } from "../publication/discord-channel-resolver.js";
import { createPipelineCollectAdapters } from "./pipeline-collector.js";

type PrismaClient = ReturnType<typeof createPrismaClient>;

export type AdminOpsRuntime = {
  readonly prisma: PrismaClient;
  readonly ops: AdminOpsService;
  readonly pipelineOrchestrator: PipelineOrchestrator;
  readonly registryPath: string;
  loadRegistry(): ReturnType<typeof loadSourceRegistry>;
  disconnect(): Promise<void>;
};

export type BuildAdminOpsRuntimeOptions = {
  readonly config: Config;
  readonly client: Client;
  readonly prisma?: PrismaClient;
  readonly isDiscordReady?: () => boolean;
};

/**
 * Thin composition host for Discord admin ops (009.1E).
 * Wires existing orchestrators only — no editorial logic in the bot.
 */
export function buildAdminOpsRuntime(
  options: BuildAdminOpsRuntimeOptions,
): AdminOpsRuntime {
  const { config, client } = options;
  const prisma =
    options.prisma ??
    createPrismaClient({ datasourceUrl: config.database.url });

  const httpClient = createSecureHttpClient();
  const { collector, normalizeFeedArticles } =
    createPipelineCollectAdapters(httpClient);

  const inferenceLocks = createInferenceLockRepository(prisma);
  const inferenceHolderId = `bot-ollama:${process.pid}`;

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
    ollamaBaseUrl: config.ollama.baseUrl,
    logger: {
      info: (message, detail) => {
        console.info(`[admin-analysis] ${message}`, detail ?? "");
      },
      warn: (message, detail) => {
        console.warn(`[admin-analysis] ${message}`, detail ?? "");
      },
    },
  });

  const matchingOrchestrator = createMatchingOrchestrator(prisma);

  let publicationOrchestrator:
    | ReturnType<typeof createPublicationOrchestrator>
    | undefined;

  if (config.discord.guildId !== undefined) {
    const discordPort = createDiscordPublicationAdapter(client);
    publicationOrchestrator = createPublicationOrchestrator(prisma, {
      discordPort,
      resolveChannelId: createPublicationChannelResolver(config),
      guildId: config.discord.guildId,
      executionHolderId: `bot-pub:${process.pid}`,
    });
  }

  const isDiscordReady =
    options.isDiscordReady ?? (() => client.isReady());

  const logInvalidSource = (report: {
    readonly index: number;
    readonly sourceId: string | null;
    readonly provider: string | null;
    readonly reason: string;
    readonly action: "disabled";
  }): void => {
    console.warn("[admin-pipeline] registry.invalid_source", {
      event: "registry.invalid_source",
      sourceId: report.sourceId ?? "unknown",
      provider: report.provider ?? "unknown",
      reason: report.reason,
      action: report.action,
      index: report.index,
    });
  };

  const pipelineOrchestrator = createPipelineOrchestrator(prisma, {
    loadSourceRegistry: () =>
      loadSourceRegistry(config.sources.registryPath, {
        mode: "resilient",
        onInvalidSource: logInvalidSource,
      }),
    collector,
    normalizeFeedArticles,
    matchingOrchestrator,
    analysisOrchestrator,
    publicationOrchestrator,
    isDiscordAvailable: isDiscordReady,
    lockTtlMs: config.worker.lockTtlMs,
    heartbeatIntervalMs: config.worker.heartbeatIntervalMs,
    rawFeedRetentionPerSource: config.sources.rawFeedRetentionPerSource,
    rawFeedRetentionDays: config.sources.rawFeedRetentionDays,
    logger: {
      warn: (message, detail) => {
        console.warn(`[admin-pipeline] ${message}`, detail ?? "");
      },
      info: (message, detail) => {
        console.info(`[admin-pipeline] ${message}`, detail ?? "");
      },
    },
  });

  const ops = createAdminOpsService(prisma, {
    pipelineOrchestrator,
    analysisOrchestrator,
    publicationOrchestrator,
    inferenceLockRepository: inferenceLocks,
    inferenceHolderId,
    inferenceLeaseMs: config.worker.lockTtlMs,
  });

  return {
    prisma,
    ops,
    pipelineOrchestrator,
    registryPath: config.sources.registryPath,
    loadRegistry: () =>
      loadSourceRegistry(config.sources.registryPath, {
        mode: "resilient",
        onInvalidSource: logInvalidSource,
      }),
    disconnect: async () => {
      await prisma.$disconnect();
    },
  };
}
