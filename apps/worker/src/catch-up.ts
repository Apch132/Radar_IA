import { createOllamaAnalysisClient } from "@radar-ia/analysis";
import {
  createDiscordPublicationAdapter,
  createPublicationChannelResolver,
} from "@radar-ia/bot/publication";
import { config as defaultConfig, type Config } from "@radar-ia/config";
import {
  createAnalysisOrchestrator,
  createPrismaClient,
  createPublicationOrchestrator,
  createPublicationRepository,
} from "@radar-ia/database";
import { Client, GatewayIntentBits } from "discord.js";

export const CATCH_UP_SOURCE_IDS = [
  "cursor-blog",
  "cursor-changelog",
  "openai-news",
  "google-ai",
  "google-deepmind",
  "meta-ai-blog",
  "microsoft-ai-blog",
  "huggingface-blog",
  "ollama-blog",
  "qwen-blog",
  "anthropic-news",
  "mistral-news",
] as const;

export type CatchUpCandidate = {
  readonly articleId: string;
  readonly sourceId: string;
  readonly date: Date | null;
  readonly title: string;
  readonly rule: string;
  readonly currentState: string;
  readonly proposedChannel: string;
  readonly idempotencyKey: string;
  readonly folderId: string;
};

type CatchUpPrisma = {
  newsFolder: {
    findMany(args: unknown): Promise<
      Array<{
        id: string;
        status: string;
        folderPublication?: { mainMessageId: string | null } | null;
        articles: Array<{
          article: {
            id: string;
            sourceId: string;
            publishedAt: Date | null;
            title: string;
          };
        }>;
      }>
    >;
  };
  $disconnect?: () => Promise<void>;
};

export type RunCatchUpOptions = {
  readonly dryRun?: boolean;
  readonly since?: Date | string;
  readonly until?: Date | string;
  readonly execute?: boolean;
  readonly prisma?: CatchUpPrisma;
  readonly config?: Config;
  readonly write?: (line: string) => void;
  /** Injection point for tests / custom orchestration. */
  readonly reanalyze?: (folderId: string) => Promise<void>;
};

function date(value: Date | string | undefined): Date | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ISO date: ${String(value)}`);
  }
  return parsed;
}

/**
 * Bounded catch-up for priority official sources.
 * Default mode is dry-run. Execute re-runs analysis (+ publish path) for folders
 * without a main Discord message in the configured window.
 */
export async function runCatchUp(
  options: RunCatchUpOptions = {},
): Promise<CatchUpCandidate[]> {
  const cfg = options.config ?? defaultConfig;
  const ownsPrisma = options.prisma === undefined;
  const prisma =
    options.prisma ??
    (createPrismaClient({
      datasourceUrl: cfg.database.url,
    }) as unknown as CatchUpPrisma);
  const since = date(options.since);
  const until = date(options.until);
  const dryRun = options.dryRun ?? options.execute !== true;
  const write = options.write ?? console.log;

  const folders = await prisma.newsFolder.findMany({
    where: {
      status: { in: ["open", "idle"] },
      articles: {
        some: { article: { sourceId: { in: [...CATCH_UP_SOURCE_IDS] } } },
      },
    },
    include: {
      folderPublication: true,
      articles: { include: { article: true } },
    },
  });

  const candidates: CatchUpCandidate[] = [];
  for (const folder of folders) {
    if (folder.folderPublication?.mainMessageId) {
      continue;
    }
    for (const membership of folder.articles) {
      const article = membership.article;
      if (
        !(CATCH_UP_SOURCE_IDS as readonly string[]).includes(article.sourceId)
      ) {
        continue;
      }
      if (since && article.publishedAt && article.publishedAt < since) {
        continue;
      }
      if (until && article.publishedAt && article.publishedAt > until) {
        continue;
      }
      candidates.push({
        articleId: article.id,
        sourceId: article.sourceId,
        date: article.publishedAt,
        title: article.title,
        rule: "priority_source_reanalysis",
        currentState: folder.status,
        proposedChannel: "analysis_required",
        idempotencyKey: `publish:${folder.id}`,
        folderId: folder.id,
      });
    }
  }

  if (dryRun) {
    write(
      JSON.stringify({
        event: "catch_up.dry_run",
        candidateCount: candidates.length,
        since: since?.toISOString() ?? null,
        until: until?.toISOString() ?? null,
      }),
    );
    for (const candidate of candidates) {
      write(JSON.stringify(candidate));
    }
  }

  if (options.execute === true) {
    const reanalyze =
      options.reanalyze ??
      (await buildDefaultReanalyze(cfg, prisma as never));
    const uniqueFolders = [...new Set(candidates.map((c) => c.folderId))];
    write(
      JSON.stringify({
        event: "catch_up.execute",
        folderCount: uniqueFolders.length,
      }),
    );
    for (const folderId of uniqueFolders) {
      await reanalyze(folderId);
      write(
        JSON.stringify({
          event: "catch_up.folder_processed",
          folderId,
          idempotencyKey: `publish:${folderId}`,
        }),
      );
    }
  }

  if (ownsPrisma) {
    await prisma.$disconnect?.();
  }
  return candidates;
}

async function buildDefaultReanalyze(
  cfg: Config,
  prisma: ReturnType<typeof createPrismaClient>,
): Promise<(folderId: string) => Promise<void>> {
  const ollamaClient = createOllamaAnalysisClient({
    config: {
      baseUrl: cfg.ollama.baseUrl,
      model: cfg.ollama.model,
      maxConcurrency: 1,
    },
  });
  const analysisOrchestrator = createAnalysisOrchestrator(prisma, {
    ollamaClient,
    expectedModelId: cfg.ollama.model,
    ollamaBaseUrl: cfg.ollama.baseUrl,
  });
  const publicationRepository = createPublicationRepository(prisma);

  let publicationOrchestrator:
    | ReturnType<typeof createPublicationOrchestrator>
    | undefined;
  let discordClient: Client | undefined;

  if (
    cfg.discord.token !== undefined &&
    cfg.discord.guildId !== undefined
  ) {
    discordClient = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    });
    await discordClient.login(cfg.discord.token);
    publicationOrchestrator = createPublicationOrchestrator(prisma, {
      discordPort: createDiscordPublicationAdapter(discordClient),
      resolveChannelId: createPublicationChannelResolver(cfg),
      guildId: cfg.discord.guildId,
      executionHolderId: `catch-up:${process.pid}`,
    });
  }

  return async (folderId: string) => {
    try {
      const pub = await publicationRepository.getPublicationByFolder(folderId);
      const result = await analysisOrchestrator.process({
        matchingIssue: "create_dossier",
        folderId,
        hasMainPublication: pub?.hasMainPublication === true,
        forceReanalysis: true,
      });
      if (
        publicationOrchestrator !== undefined &&
        result.publicationDecision !== null &&
        result.attemptId !== null &&
        (result.publicationDecision === "publish" ||
          result.publicationDecision === "enrich_thread_only")
      ) {
        await publicationOrchestrator.process({
          folderId,
          decision: result.publicationDecision,
          analysisAttemptId: result.attemptId,
          channelHint: result.channelHint,
          aggregateFingerprint: result.aggregateFingerprint,
          validatedContent: result.analysis?.proposal
            ? {
                summary: result.analysis.proposal.summary,
                primaryCategory:
                  result.analysis.proposal.classification.primaryCategory,
                publishWorthiness:
                  result.analysis.proposal.editorialProposal.publishWorthiness,
                composite: result.analysis.backendScoring?.composite ?? 0,
              }
            : null,
          decisionMethod:
            result.analysis?.proposalOrigin === "deterministic_fallback"
              ? "deterministic_fallback"
              : "llm_analysis",
        });
      }
    } finally {
      // Client kept for the whole catch-up batch; destroyed by caller process exit.
      void discordClient;
    }
  };
}

function parseArgs(argv: readonly string[]): RunCatchUpOptions {
  let dryRun = true;
  let execute = false;
  let since: string | undefined;
  let until: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--execute") {
      execute = true;
      dryRun = false;
    } else if (arg === "--since") {
      since = argv[++index];
    } else if (arg === "--until") {
      until = argv[++index];
    } else {
      throw new Error(`Unknown catch-up option: ${arg}`);
    }
  }
  return { dryRun, execute, since, until };
}

if (
  process.argv[1]?.endsWith("catch-up.ts") ||
  process.argv[1]?.endsWith("catch-up.js")
) {
  runCatchUp(parseArgs(process.argv.slice(2))).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
