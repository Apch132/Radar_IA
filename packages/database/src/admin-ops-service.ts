import type { PrismaClient } from "@prisma/client";

import {
  createAdminOperationLogRepository,
  createPipelineLockRepository,
  type AdminOperationLogRepository,
  type PipelineLockRepository,
} from "./administration-repository.js";
import type {
  AdminForceReanalysisResult,
  AdminHealthDashboard,
  AdminInterventionItem,
  AdminOpsActorContext,
  AdminPipelineStatus,
  AdminResumePublicationResult,
  AdminRunCycleResult,
  AdminSourceRegistryLoader,
  AdminSourcesStatus,
  AdminSourceStatusItem,
} from "./admin-ops-types.js";
import {
  createInferenceLockRepository,
  type InferenceLockRepository,
} from "./inference-lock-repository.js";
import { createRawFeedRepository } from "./raw-feed-repository.js";
import { createPublicationRepository } from "./publication-repository.js";
import type { PipelineOrchestrator } from "./pipeline-orchestrator.js";
import type { AnalysisOrchestrator } from "./analysis-orchestrator.js";
import type { PublicationOrchestrator } from "./publication-orchestrator.js";
import { sanitizePipelineMessage } from "./pipeline-orchestration-types.js";

const DEFAULT_INTERVENTION_LIMIT = 25;
const MAX_INTERVENTION_LIMIT = 50;

export type AdminOpsServiceOptions = {
  readonly lockRepository?: PipelineLockRepository;
  readonly adminLogRepository?: AdminOperationLogRepository;
  readonly pipelineOrchestrator?: PipelineOrchestrator;
  readonly analysisOrchestrator?: AnalysisOrchestrator;
  readonly publicationOrchestrator?: PublicationOrchestrator;
  /** Cross-process Ollama lock (010.1A AUD-003). */
  readonly inferenceLockRepository?: InferenceLockRepository;
  readonly inferenceHolderId?: string;
  readonly inferenceLeaseMs?: number;
  /** Clock for backoff eligibility (tests). */
  readonly now?: () => Date;
};

export interface AdminOpsService {
  getPipelineStatus(): Promise<AdminPipelineStatus>;
  getSourcesStatus(input: {
    loadRegistry: AdminSourceRegistryLoader;
    registryPath?: string;
  }): Promise<AdminSourcesStatus>;
  getHealthDashboard(input: {
    loadRegistry: AdminSourceRegistryLoader;
  }): Promise<AdminHealthDashboard>;
  listInterventions(options?: {
    limit?: number;
  }): Promise<readonly AdminInterventionItem[]>;
  runCycle(
    actor: AdminOpsActorContext,
    input: { holderId: string },
  ): Promise<AdminRunCycleResult>;
  resumePublication(
    actor: AdminOpsActorContext,
    input: { folderId: string },
  ): Promise<AdminResumePublicationResult>;
  resumeAllRetryable(
    actor: AdminOpsActorContext,
  ): Promise<{
    readonly outcome: "succeeded" | "failed" | "skipped";
    readonly auditId: string;
    readonly results: readonly AdminResumePublicationResult[];
  }>;
  forceReanalysis(
    actor: AdminOpsActorContext,
    input: { folderId: string; confirm: boolean },
  ): Promise<AdminForceReanalysisResult>;
}

async function resolveRegistry(loader: AdminSourceRegistryLoader): Promise<{
  sources: readonly {
    id: string;
    name: string;
    tier: string;
    enabled: boolean;
  }[];
}> {
  return typeof loader === "function" ? await loader() : loader;
}

function emptyCycleResult(
  message: string,
): import("./pipeline-orchestration-types.js").PipelineCycleResult {
  const sources = {
    total: 0,
    enabled: 0,
    collected: 0,
    notModified: 0,
    skippedDisabled: 0,
    skippedBackoff: 0,
    failed: 0,
  };
  const articles = {
    normalized: 0,
    rejected: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
  };
  const matching = {
    create_dossier: 0,
    attach_enrich: 0,
    duplicate_editorial: 0,
    ambiguous_no_action: 0,
    failed: 0,
    skipped: 0,
  };
  const analysis = { analyzed: 0, reused: 0, skipped: 0, failed: 0 };
  const publication = {
    published: 0,
    enriched: 0,
    resumed: 0,
    skipped: 0,
    failed: 0,
    deferred: 0,
  };
  const startedAt = new Date();
  return {
    runId: null,
    status: null,
    trigger: "manual",
    startedAt,
    finishedAt: startedAt,
    lockAcquired: false,
    lockStolen: false,
    rejectionCode: "invariant_violated",
    degraded: false,
    sources,
    articles,
    matching,
    analysis,
    publication,
    errors: [{ code: "invariant_violated", message }],
    summary: {
      version: 1,
      degraded: false,
      rejectionCode: "invariant_violated",
      sources,
      articles,
      matching,
      analysis,
      publication,
      errorCodes: ["invariant_violated"],
    },
  };
}

function assertNonEmpty(value: string, field: string): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function extractRunErrorCodes(summary: unknown): string[] {
  if (
    summary &&
    typeof summary === "object" &&
    "errorCodes" in summary &&
    Array.isArray((summary as { errorCodes: unknown }).errorCodes)
  ) {
    return (summary as { errorCodes: unknown[] }).errorCodes
      .filter((code): code is string => typeof code === "string")
      .slice(0, 20);
  }
  return [];
}

/**
 * Admin ops façade (009.1E): status / interventions + audited calls to
 * existing 006–008 / pipeline orchestrators. No Discord, no editorial rules.
 */
export function createAdminOpsService(
  prisma: PrismaClient,
  options: AdminOpsServiceOptions = {},
): AdminOpsService {
  const lockRepository =
    options.lockRepository ?? createPipelineLockRepository(prisma);
  const adminLog =
    options.adminLogRepository ?? createAdminOperationLogRepository(prisma);
  const rawFeed = createRawFeedRepository(prisma);
  const publications = createPublicationRepository(prisma);
  const now = options.now ?? (() => new Date());

  return {
    async getPipelineStatus() {
      const [lock, latestRun, needingResume, inconsistent, partial, failed] =
        await Promise.all([
          lockRepository.getLock(),
          lockRepository.getLatestRun(),
          publications.listPublicationsNeedingResume(),
          prisma.folderPublication.count({
            where: { status: "inconsistent" },
          }),
          prisma.folderPublication.count({ where: { status: "partial" } }),
          prisma.folderPublication.count({ where: { status: "failed" } }),
        ]);

      const [exhaustedFolders, ambiguousRecent, closed] = await Promise.all([
        prisma.analysisAttempt.findMany({
          where: { errorCodes: { has: "analysis_exhausted" } },
          distinct: ["folderId"],
          select: { folderId: true },
          take: 500,
        }),
        prisma.matchingDecision.count({
          where: {
            issue: "ambiguous_no_action",
            decidedAt: { gte: new Date(now().getTime() - 7 * 24 * 60 * 60_000) },
          },
        }),
        prisma.newsFolder.count({ where: { status: "closed" } }),
      ]);

      return {
        lock,
        latestRun,
        publication: {
          needingResume: needingResume.length,
          inconsistent,
          partial,
          failed,
        },
        analysis: { exhaustedFolders: exhaustedFolders.length },
        matching: { ambiguousRecent },
        folders: { closed },
      };
    },

    async getSourcesStatus(input) {
      const registry = await resolveRegistry(input.loadRegistry);
      const states = await rawFeed.listCollectedSourceStates();
      const stateById = new Map(states.map((s) => [s.sourceId, s]));
      const reference = now();

      const sources: AdminSourceStatusItem[] = registry.sources.map((def) => {
        const state = stateById.get(def.id);
        const nextEligibleAt = state?.nextEligibleAt ?? null;
        const inBackoff =
          nextEligibleAt !== null &&
          nextEligibleAt.getTime() > reference.getTime();
        return {
          sourceId: def.id,
          name: def.name,
          enabled: def.enabled,
          tier: def.tier,
          lastSuccessfulAt: state?.lastSuccessfulAt ?? null,
          lastHttpStatus: state?.lastHttpStatus ?? null,
          consecutiveFailures: state?.consecutiveFailures ?? 0,
          nextEligibleAt,
          inBackoff,
        };
      });

      return {
        registryPath: input.registryPath ?? "(configured)",
        definitionCount: registry.sources.length,
        enabledCount: registry.sources.filter((s) => s.enabled).length,
        sources,
      };
    },

    async getHealthDashboard(input) {
      const registry = await resolveRegistry(input.loadRegistry);
      const states = await rawFeed.listCollectedSourceStates();
      const stateById = new Map(states.map((s) => [s.sourceId, s]));
      const reference = now();

      let live = 0;
      let broken = 0;
      let disabled = 0;
      let enabled = 0;
      let inBackoff = 0;

      for (const def of registry.sources) {
        if (!def.enabled) {
          disabled += 1;
          continue;
        }
        enabled += 1;
        const state = stateById.get(def.id);
        const nextEligibleAt = state?.nextEligibleAt ?? null;
        const sourceInBackoff =
          nextEligibleAt !== null &&
          nextEligibleAt.getTime() > reference.getTime();
        if (sourceInBackoff) {
          inBackoff += 1;
        }
        const failures = state?.consecutiveFailures ?? 0;
        const http = state?.lastHttpStatus ?? null;
        const isBroken =
          failures >= 3 ||
          (http !== null && http >= 400) ||
          sourceInBackoff;
        if (isBroken) {
          broken += 1;
        } else {
          live += 1;
        }
      }

      const [
        articleTotal,
        folderTotal,
        folderOpen,
        folderClosed,
        analysisTotal,
        exhaustedFolders,
        publicationTotal,
        publicationMainPublished,
        needingResume,
        publicationFailed,
        publicationPartial,
        publicationInconsistent,
        latestRun,
        completedRuns,
        lastPublication,
      ] = await Promise.all([
        prisma.normalizedArticle.count(),
        prisma.newsFolder.count(),
        prisma.newsFolder.count({ where: { status: "open" } }),
        prisma.newsFolder.count({ where: { status: "closed" } }),
        prisma.analysisAttempt.count(),
        prisma.analysisAttempt.findMany({
          where: { errorCodes: { has: "analysis_exhausted" } },
          distinct: ["folderId"],
          select: { folderId: true },
          take: 500,
        }),
        prisma.folderPublication.count(),
        prisma.folderPublication.count({ where: { status: "main_published" } }),
        publications.listPublicationsNeedingResume(),
        prisma.folderPublication.count({ where: { status: "failed" } }),
        prisma.folderPublication.count({ where: { status: "partial" } }),
        prisma.folderPublication.count({ where: { status: "inconsistent" } }),
        lockRepository.getLatestRun(),
        prisma.pipelineRun.findMany({
          where: {
            status: { in: ["completed", "degraded", "failed"] },
            finishedAt: { not: null },
          },
          orderBy: { finishedAt: "desc" },
          take: 20,
          select: {
            startedAt: true,
            finishedAt: true,
            status: true,
            summary: true,
            errorMessage: true,
          },
        }),
        prisma.folderPublication.findFirst({
          where: { mainMessageId: { not: null } },
          orderBy: { updatedAt: "desc" },
          select: { updatedAt: true },
        }),
      ]);

      const durations = completedRuns
        .map((run) => {
          if (!run.finishedAt) {
            return null;
          }
          return run.finishedAt.getTime() - run.startedAt.getTime();
        })
        .filter((value): value is number => value !== null && value >= 0);

      const averageCycleDurationMs =
        durations.length === 0
          ? null
          : Math.round(
              durations.reduce((sum, value) => sum + value, 0) / durations.length,
            );
      const lastCycleDurationMs = durations[0] ?? null;

      const latestRunErrorCodes = extractRunErrorCodes(latestRun?.summary);
      if (
        latestRunErrorCodes.length === 0 &&
        typeof latestRun?.errorMessage === "string" &&
        latestRun.errorMessage.trim() !== ""
      ) {
        latestRunErrorCodes.push("run_error_message");
      }

      const lastSuccessfulCycle =
        completedRuns.find((run) => run.status === "completed") ?? null;

      return {
        generatedAt: reference,
        sources: { live, broken, disabled, enabled, inBackoff },
        articles: { total: articleTotal },
        folders: {
          total: folderTotal,
          open: folderOpen,
          closed: folderClosed,
        },
        analyses: {
          total: analysisTotal,
          exhaustedFolders: exhaustedFolders.length,
        },
        publications: {
          total: publicationTotal,
          mainPublished: publicationMainPublished,
          needingResume: needingResume.length,
          failed: publicationFailed,
          partial: publicationPartial,
          inconsistent: publicationInconsistent,
        },
        errors: {
          latestRunErrorCount: latestRunErrorCodes.length,
          latestRunErrorCodes,
        },
        timing: {
          averageCycleDurationMs,
          lastCycleDurationMs,
        },
        lastPublicationAt: lastPublication?.updatedAt ?? null,
        lastSuccessfulCycleAt: lastSuccessfulCycle?.finishedAt ?? null,
      };
    },

    async listInterventions(listOptions) {
      const limit = Math.min(
        Math.max(1, listOptions?.limit ?? DEFAULT_INTERVENTION_LIMIT),
        MAX_INTERVENTION_LIMIT,
      );
      const items: AdminInterventionItem[] = [];

      const [pubs, exhausted, ambiguous, closed] = await Promise.all([
        prisma.folderPublication.findMany({
          where: {
            status: { in: ["partial", "failed", "inconsistent"] },
          },
          orderBy: { updatedAt: "desc" },
          take: limit,
          select: {
            folderId: true,
            status: true,
            lastErrorCode: true,
            updatedAt: true,
          },
        }),
        prisma.analysisAttempt.findMany({
          where: { errorCodes: { has: "analysis_exhausted" } },
          orderBy: { analyzedAt: "desc" },
          distinct: ["folderId"],
          take: limit,
          select: {
            folderId: true,
            analyzedAt: true,
            publicationDecision: true,
          },
        }),
        prisma.matchingDecision.findMany({
          where: { issue: "ambiguous_no_action" },
          orderBy: { decidedAt: "desc" },
          take: limit,
          select: {
            folderId: true,
            articleId: true,
            decidedAt: true,
          },
        }),
        prisma.newsFolder.findMany({
          where: { status: "closed" },
          orderBy: { updatedAt: "desc" },
          take: Math.min(10, limit),
          select: { id: true, updatedAt: true },
        }),
      ]);

      for (const pub of pubs) {
        const reason =
          pub.status === "partial"
            ? "publication_partial"
            : pub.status === "failed"
              ? "publication_failed"
              : "publication_inconsistent";
        items.push({
          reason,
          folderId: pub.folderId,
          articleId: null,
          detail: pub.lastErrorCode,
          updatedAt: pub.updatedAt,
        });
      }
      for (const row of exhausted) {
        items.push({
          reason: "analysis_exhausted",
          folderId: row.folderId,
          articleId: null,
          detail: row.publicationDecision,
          updatedAt: row.analyzedAt,
        });
      }
      for (const row of ambiguous) {
        items.push({
          reason: "ambiguous_no_action",
          folderId: row.folderId,
          articleId: row.articleId,
          detail: null,
          updatedAt: row.decidedAt,
        });
      }
      for (const row of closed) {
        items.push({
          reason: "folder_closed",
          folderId: row.id,
          articleId: null,
          detail: null,
          updatedAt: row.updatedAt,
        });
      }

      items.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      return items.slice(0, limit);
    },

    async runCycle(actor, input) {
      assertNonEmpty(actor.actorId, "actorId");
      assertNonEmpty(input.holderId, "holderId");
      const orchestrator = options.pipelineOrchestrator;
      if (orchestrator === undefined) {
        const audit = await adminLog.recordOperation({
          actorId: actor.actorId,
          kind: "run_cycle",
          target: { holderId: input.holderId },
          outcome: "failed",
          detail: "pipeline orchestrator not configured",
        });
        return {
          outcome: "failed",
          auditId: audit.id,
          cycle: emptyCycleResult("pipeline orchestrator not configured"),
        };
      }

      const cycle = await orchestrator.runCycle({
        holderId: input.holderId,
        trigger: "manual",
      });

      let outcome: "succeeded" | "failed" | "skipped" | "accepted" = "succeeded";
      if (cycle.rejectionCode === "concurrent_lock") {
        outcome = "skipped";
      } else if (cycle.status === "failed" || cycle.rejectionCode !== null) {
        outcome = "failed";
      } else if (cycle.status === "degraded") {
        outcome = "succeeded";
      }

      const audit = await adminLog.recordOperation({
        actorId: actor.actorId,
        kind: "run_cycle",
        target: {
          holderId: input.holderId,
          runId: cycle.runId,
          rejectionCode: cycle.rejectionCode,
        },
        outcome,
        detail: sanitizePipelineMessage(
          `status=${cycle.status ?? "none"}; lock=${cycle.lockAcquired}`,
        ),
        pipelineRunId: cycle.runId,
      });

      return { outcome, auditId: audit.id, cycle };
    },

    async resumePublication(actor, input) {
      assertNonEmpty(actor.actorId, "actorId");
      assertNonEmpty(input.folderId, "folderId");
      const orchestrator = options.publicationOrchestrator;
      if (orchestrator === undefined) {
        const audit = await adminLog.recordOperation({
          actorId: actor.actorId,
          kind: "resume_publication",
          target: { folderId: input.folderId },
          outcome: "failed",
          detail: "publication orchestrator not configured",
        });
        return {
          outcome: "failed",
          auditId: audit.id,
          folderId: input.folderId,
          kind: "failed",
          detail: "publication orchestrator not configured",
        };
      }

      try {
        const result = await orchestrator.resume(input.folderId);
        const outcome =
          result.kind === "failed"
            ? "failed"
            : result.kind === "skipped"
              ? "skipped"
              : "succeeded";
        const audit = await adminLog.recordOperation({
          actorId: actor.actorId,
          kind: "resume_publication",
          target: { folderId: input.folderId, kind: result.kind },
          outcome,
          detail: sanitizePipelineMessage(`resume kind=${result.kind}`),
        });
        return {
          outcome,
          auditId: audit.id,
          folderId: input.folderId,
          kind: result.kind,
          detail: `resume kind=${result.kind}`,
        };
      } catch (error) {
        const message = sanitizePipelineMessage(
          error instanceof Error ? error.message : "resume failed",
        );
        const audit = await adminLog.recordOperation({
          actorId: actor.actorId,
          kind: "resume_publication",
          target: { folderId: input.folderId },
          outcome: "failed",
          detail: message,
        });
        return {
          outcome: "failed",
          auditId: audit.id,
          folderId: input.folderId,
          kind: "failed",
          detail: message,
        };
      }
    },

    async resumeAllRetryable(actor) {
      assertNonEmpty(actor.actorId, "actorId");
      const needing = await publications.listPublicationsNeedingResume();
      const retryable = needing.filter((p) => p.status !== "inconsistent");
      if (retryable.length === 0) {
        const audit = await adminLog.recordOperation({
          actorId: actor.actorId,
          kind: "resume_publication",
          target: { scope: "all_retryable", count: 0 },
          outcome: "skipped",
          detail: "no publications needing resume",
        });
        return { outcome: "skipped", auditId: audit.id, results: [] };
      }

      const results: AdminResumePublicationResult[] = [];
      for (const pub of retryable) {
        results.push(
          await this.resumePublication(actor, { folderId: pub.folderId }),
        );
      }

      const anyFailed = results.some((r) => r.outcome === "failed");
      const anySucceeded = results.some((r) => r.outcome === "succeeded");
      const outcome = anyFailed
        ? "failed"
        : anySucceeded
          ? "succeeded"
          : "skipped";

      const audit = await adminLog.recordOperation({
        actorId: actor.actorId,
        kind: "resume_publication",
        target: {
          scope: "all_retryable",
          count: results.length,
          folderIds: results.map((r) => r.folderId),
        },
        outcome,
        detail: sanitizePipelineMessage(
          `resumed=${results.filter((r) => r.outcome === "succeeded").length}/${results.length}`,
        ),
      });

      return { outcome, auditId: audit.id, results };
    },

    async forceReanalysis(actor, input) {
      assertNonEmpty(actor.actorId, "actorId");
      assertNonEmpty(input.folderId, "folderId");

      if (!input.confirm) {
        const audit = await adminLog.recordOperation({
          actorId: actor.actorId,
          kind: "force_reanalysis",
          target: { folderId: input.folderId },
          outcome: "rejected",
          detail: "confirmation required (confirm=true)",
        });
        return {
          outcome: "rejected",
          auditId: audit.id,
          folderId: input.folderId,
          status: "rejected",
          detail: "confirmation required (confirm=true)",
        };
      }

      const orchestrator = options.analysisOrchestrator;
      if (orchestrator === undefined) {
        const audit = await adminLog.recordOperation({
          actorId: actor.actorId,
          kind: "force_reanalysis",
          target: { folderId: input.folderId },
          outcome: "failed",
          detail: "analysis orchestrator not configured",
        });
        return {
          outcome: "failed",
          auditId: audit.id,
          folderId: input.folderId,
          status: "failed",
          detail: "analysis orchestrator not configured",
        };
      }

      const publication = await publications.getPublicationByFolder(
        input.folderId,
      );
      const hasMainPublication = publication?.hasMainPublication ?? false;

      const inferenceLocks =
        options.inferenceLockRepository ??
        createInferenceLockRepository(prisma);
      const inferenceHolderId =
        options.inferenceHolderId ?? `admin-reanalyse:${actor.actorId}`;
      const inferenceLeaseMs = options.inferenceLeaseMs ?? 5 * 60_000;
      const now = options.now?.() ?? new Date();
      const lease = await inferenceLocks.tryAcquire({
        holderId: inferenceHolderId,
        expiresAt: new Date(now.getTime() + inferenceLeaseMs),
        now,
      });
      if (lease.kind === "blocked") {
        const audit = await adminLog.recordOperation({
          actorId: actor.actorId,
          kind: "force_reanalysis",
          target: { folderId: input.folderId },
          outcome: "rejected",
          detail: "ollama inference lock busy",
        });
        return {
          outcome: "rejected",
          auditId: audit.id,
          folderId: input.folderId,
          status: "rejected",
          detail: "ollama inference lock busy",
        };
      }

      try {
        const result = await orchestrator.process({
          matchingIssue: "create_dossier",
          folderId: input.folderId,
          forceReanalysis: true,
          hasMainPublication,
        });

        const outcome =
          result.status === "failed"
            ? "failed"
            : result.status === "skipped"
              ? "skipped"
              : "succeeded";

        const audit = await adminLog.recordOperation({
          actorId: actor.actorId,
          kind: "force_reanalysis",
          target: {
            folderId: input.folderId,
            status: result.status,
            attemptId: result.attemptId,
          },
          outcome,
          detail: sanitizePipelineMessage(
            `status=${result.status}; decision=${result.publicationDecision ?? "none"}`,
          ),
        });

        return {
          outcome,
          auditId: audit.id,
          folderId: input.folderId,
          status: result.status,
          detail: `status=${result.status}`,
        };
      } catch (error) {
        const message = sanitizePipelineMessage(
          error instanceof Error ? error.message : "force reanalysis failed",
        );
        const audit = await adminLog.recordOperation({
          actorId: actor.actorId,
          kind: "force_reanalysis",
          target: { folderId: input.folderId },
          outcome: "failed",
          detail: message,
        });
        return {
          outcome: "failed",
          auditId: audit.id,
          folderId: input.folderId,
          status: "failed",
          detail: message,
        };
      } finally {
        await inferenceLocks
          .release({ holderId: inferenceHolderId, now: options.now?.() })
          .catch(() => undefined);
      }
    },
  };
}
