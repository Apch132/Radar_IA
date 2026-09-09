import { computeAggregateFingerprint } from "./aggregate-fingerprint.js";
import {
  buildAnalysisFailedEvent,
  buildAnalysisSucceededEvent,
  mapInferenceErrorToLogCode,
} from "./analysis-events.js";
import { buildAnalysisContext } from "./analysis-context-builder.js";
import {
  decidePublication,
  mapChannelSalonHint,
} from "./analysis-decision.js";
import { evaluateEligibility } from "./analysis-eligibility.js";
import {
  deduplicateEntities,
  validateAndAnchorFacts,
} from "./analysis-fact-validation.js";
import {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserPrompt,
} from "./analysis-prompt.js";
import {
  computeBackendScoring,
  resolveBestSourceTier,
} from "./analysis-scoring.js";
import type { AnalysisProposalV1 } from "./analysis-proposal-types.js";
import type {
  AnalysisAttemptPersistence,
  AnalysisErrorCode,
  AnalysisFailureDetail,
  AnalysisServiceClock,
  AnalysisServiceLogger,
  AnalysisServiceResult,
  AnalyzeFolderInput,
  CreateAnalysisServiceDependencies,
  ValidatedAnalysisV1,
} from "./analysis-service-types.js";
import { OLLAMA_MAX_ATTEMPTS } from "./analysis-constants.js";
import { evaluateDeterministicFallback } from "./deterministic-fallback.js";
import {
  evaluateImportance,
  isCriticalImportance,
} from "./importance-evaluation.js";

export type {
  AnalyzeFolderInput,
  AnalysisServiceResult,
  CreateAnalysisServiceDependencies,
  AnalysisAttemptPersistence,
} from "./analysis-service-types.js";

const DEFAULT_CLOCK: AnalysisServiceClock = {
  now: () => new Date(),
};

export interface AnalysisService {
  analyze(input: AnalyzeFolderInput): Promise<AnalysisServiceResult>;
}

function toIso(date: Date): string {
  return date.toISOString();
}

function normalizeProposalOrigin(
  value: string | null | undefined,
): ValidatedAnalysisV1["proposalOrigin"] {
  if (value === "deterministic_fallback") {
    return "deterministic_fallback";
  }
  if (value === "llm_analysis" || value === "llm") {
    return value === "llm" ? "llm" : "llm_analysis";
  }
  return "llm_analysis";
}

function decisionMethodFromOrigin(
  origin: ValidatedAnalysisV1["proposalOrigin"],
): "llm_analysis" | "deterministic_fallback" {
  return origin === "deterministic_fallback"
    ? "deterministic_fallback"
    : "llm_analysis";
}

function emitAnalysisFailed(
  logger: AnalysisServiceLogger | undefined,
  event: ReturnType<typeof buildAnalysisFailedEvent>,
): void {
  if (!logger) {
    return;
  }
  // Prefer warn; fall back to info so Docker stdout scrapes that only
  // capture `console.info` still see the structured failure event.
  if (typeof logger.warn === "function") {
    logger.warn("analysis.failed", event);
    return;
  }
  logger.info("analysis.failed", event);
}

function recordToValidated(record: {
  id: string;
  folderId: string;
  aggregateFingerprint: string;
  analyzedAt: Date;
  modelId: string | null;
  proposalOrigin?: string | null;
  validationStatus: ValidatedAnalysisV1["validation"]["status"];
  proposal: AnalysisProposalV1 | null;
  backendScoring: ValidatedAnalysisV1["backendScoring"] | null;
  warnings: ValidatedAnalysisV1["validation"]["warnings"];
  droppedFacts: ValidatedAnalysisV1["validation"]["droppedFacts"];
}): ValidatedAnalysisV1 {
  return {
    schemaVersion: "1",
    folderId: record.folderId,
    analyzedAt: toIso(record.analyzedAt),
    modelId: record.modelId ?? "",
    proposalOrigin: normalizeProposalOrigin(record.proposalOrigin),
    aggregateFingerprint: record.aggregateFingerprint,
    ...(record.proposal ? { proposal: record.proposal } : {}),
    validation: {
      status: record.validationStatus,
      warnings: [...record.warnings],
      droppedFacts: [...record.droppedFacts],
    },
    ...(record.backendScoring
      ? { backendScoring: record.backendScoring }
      : {}),
  };
}

/**
 * Service métier d’analyse IA (007.1D) + fallback déterministe contrôlé.
 */
export function createAnalysisService(
  dependencies: CreateAnalysisServiceDependencies,
): AnalysisService {
  const clock = dependencies.clock ?? DEFAULT_CLOCK;
  const { ollamaClient, persistence, expectedModelId } = dependencies;
  const logger: AnalysisServiceLogger | undefined = dependencies.logger;
  const ollamaBaseUrl =
    dependencies.ollamaBaseUrl ??
    ollamaClient.baseUrl ??
    "http://localhost:11434";

  return {
    async analyze(input: AnalyzeFolderInput): Promise<AnalysisServiceResult> {
      if (input.folderId !== input.folder.id) {
        throw new Error(
          `folderId mismatch: input.folderId=${input.folderId} folder.id=${input.folder.id}`,
        );
      }

      const articleIds = input.articles.map((a) => a.articleId);
      const sourceIds = [
        ...new Set(
          input.articles
            .map((a) => a.sourceId)
            .filter((value): value is string => typeof value === "string"),
        ),
      ];
      const fingerprint =
        input.aggregateFingerprint ??
        computeAggregateFingerprint({
          folderId: input.folderId,
          articleIds,
          enrichmentFacts: input.enrichmentFacts,
          folderStatus: input.folder.status,
        });

      const bestSourceTier = resolveBestSourceTier(
        input.articles.map((a) => a.sourceTier),
      );

      if (!input.forceReanalysis) {
        const existing =
          await persistence.getLatestAcceptedAnalysisForFingerprint(
            input.folderId,
            fingerprint,
          );
        const terminalDecision =
          existing?.publicationDecision === "publish" ||
          existing?.publicationDecision === "enrich_thread_only" ||
          existing?.publicationDecision === "reject_editorial";
        if (
          existing &&
          existing.proposal &&
          existing.backendScoring &&
          terminalDecision
        ) {
          const analysis = recordToValidated(existing);
          const channelHint = mapChannelSalonHint({
            composite: existing.backendScoring.composite,
            effectiveImpact: existing.backendScoring.effectiveImpact,
            primaryCategory: existing.proposal.classification.primaryCategory,
            suggestedChannelRole:
              existing.proposal.editorialProposal.suggestedChannelRole,
          });
          return {
            kind: "reused",
            attemptId: existing.id,
            folderId: input.folderId,
            aggregateFingerprint: fingerprint,
            decision: existing.publicationDecision,
            analysis,
            channelHint,
            decisionMethod: decisionMethodFromOrigin(analysis.proposalOrigin),
          };
        }
      }

      const eligibility = evaluateEligibility(input, bestSourceTier);
      if (!eligibility.eligible) {
        return persistSkip({
          persistence,
          clock,
          folderId: input.folderId,
          fingerprint,
          reason: eligibility.reason,
        });
      }

      const materialEnrichReanalysis = eligibility.materialEnrichReanalysis;

      const context = buildAnalysisContext({
        folderId: input.folderId,
        folderTitle: input.folder.title,
        articles: input.articles,
        enrichmentFacts: input.enrichmentFacts,
      });

      if (!context.ok) {
        return persistFailure({
          persistence,
          clock,
          folderId: input.folderId,
          fingerprint,
          modelId: null,
          errorCodes: ["context_too_large"],
          articleIds,
          sourceIds,
          logger,
          ollamaBaseUrl,
          expectedModelId,
          failureDetail: {
            stage: "request",
            errorCode: "context_too_large",
            message: "analysis context exceeds budget",
            retryable: false,
            attemptNumber: 1,
            durationMs: 0,
            model: expectedModelId,
            ollamaBaseUrl,
          },
        });
      }

      const userPrompt = buildAnalysisUserPrompt({
        contextBody: context.bodyText,
      });

      const importance = evaluateImportance({
        articles: input.articles,
        folderTitle: input.folder.title,
      });

      // Critical official majors: publish deterministically BEFORE LLM so
      // Ollama downtime/timeouts cannot silence a major announcement.
      if (isCriticalImportance(importance.level)) {
        const criticalFallback = evaluateDeterministicFallback({
          articles: input.articles,
          hasMainPublication: input.hasMainPublication,
          folderTitle: input.folder.title,
        });
        if (criticalFallback.matched) {
          const analyzedAt = clock.now();
          const recorded = await recordAttemptWithConflictRetry(
            persistence,
            input.folderId,
            fingerprint,
            (allocatedNumber) => ({
              folderId: input.folderId,
              aggregateFingerprint: fingerprint,
              attemptNumber: allocatedNumber,
              analyzedAt,
              modelId: "deterministic_fallback",
              proposalOrigin: "deterministic_fallback" as const,
              validationStatus: "accepted" as const,
              proposal: criticalFallback.proposal,
              backendScoring: criticalFallback.backendScoring,
              warnings: [],
              droppedFacts: [],
              publicationDecision: criticalFallback.decision,
              schemaVersion: "1" as const,
            }),
          );

          const analysis: ValidatedAnalysisV1 = {
            schemaVersion: "1",
            folderId: input.folderId,
            analyzedAt: toIso(analyzedAt),
            modelId: "deterministic_fallback",
            proposalOrigin: "deterministic_fallback",
            aggregateFingerprint: fingerprint,
            proposal: criticalFallback.proposal,
            validation: {
              status: "accepted",
              warnings: [],
              droppedFacts: [],
            },
            backendScoring: criticalFallback.backendScoring,
          };

          logger?.info(
            "analysis.succeeded",
            buildAnalysisSucceededEvent({
              dossierId: input.folderId,
              articleCount: input.articles.length,
              model: "deterministic_fallback",
              durationMs: 0,
              decision: criticalFallback.decision,
              decisionMethod: "deterministic_fallback",
              channelHint: criticalFallback.channelHint,
              attemptNumber: recorded.attemptNumber,
            }),
          );

          return {
            kind: "created",
            attemptId: recorded.id,
            folderId: input.folderId,
            aggregateFingerprint: fingerprint,
            decision: criticalFallback.decision,
            analysis,
            channelHint: criticalFallback.channelHint,
            attemptNumber: recorded.attemptNumber,
            decisionMethod: "deterministic_fallback",
          };
        }
      }

      const inferenceStarted = clock.now().getTime();
      const inference = await ollamaClient.infer({
        prompt: userPrompt,
        systemPrompt: ANALYSIS_SYSTEM_PROMPT,
      });
      const inferenceDurationMs =
        inference.durationMs ?? clock.now().getTime() - inferenceStarted;

      const analyzedAt = clock.now();
      const priorHolds = await persistence.countHoldDecisionsForFingerprint(
        input.folderId,
        fingerprint,
      );
      const attemptNumber =
        (await persistence.countAttemptsForFingerprint(
          input.folderId,
          fingerprint,
        )) + 1;

      if (!inference.ok) {
        const logErrorCode =
          inference.logErrorCode ??
          mapInferenceErrorToLogCode({
            errorCode: inference.errorCode,
            message: inference.message,
            statusCode: inference.statusCode,
            stage: inference.stage,
          });
        const failureDetail: AnalysisFailureDetail = {
          stage: inference.stage ?? "transport",
          errorCode: logErrorCode,
          message: inference.message,
          statusCode: inference.statusCode,
          retryable: inference.retryable ?? true,
          attemptNumber: inference.attempts || attemptNumber,
          durationMs: inferenceDurationMs,
          model: expectedModelId,
          ollamaBaseUrl,
        };

        emitAnalysisFailed(
          logger,
          buildAnalysisFailedEvent({
            dossierId: input.folderId,
            articleIds,
            sourceIds,
            model: expectedModelId,
            ollamaBaseUrl,
            detail: failureDetail,
          }),
        );

        const fallback = evaluateDeterministicFallback({
          articles: input.articles,
          hasMainPublication: input.hasMainPublication,
          folderTitle: input.folder.title,
        });

        if (fallback.matched) {
          const recorded = await recordAttemptWithConflictRetry(
            persistence,
            input.folderId,
            fingerprint,
            (allocatedNumber) => ({
              folderId: input.folderId,
              aggregateFingerprint: fingerprint,
              attemptNumber: allocatedNumber,
              analyzedAt,
              modelId: "deterministic_fallback",
              proposalOrigin: "deterministic_fallback" as const,
              validationStatus: "accepted" as const,
              proposal: fallback.proposal,
              backendScoring: fallback.backendScoring,
              warnings: [],
              droppedFacts: [],
              publicationDecision: fallback.decision,
              schemaVersion: "1" as const,
            }),
          );

          const analysis: ValidatedAnalysisV1 = {
            schemaVersion: "1",
            folderId: input.folderId,
            analyzedAt: toIso(analyzedAt),
            modelId: "deterministic_fallback",
            proposalOrigin: "deterministic_fallback",
            aggregateFingerprint: fingerprint,
            proposal: fallback.proposal,
            validation: {
              status: "accepted",
              warnings: [],
              droppedFacts: [],
            },
            backendScoring: fallback.backendScoring,
          };

          logger?.info(
            "analysis.succeeded",
            buildAnalysisSucceededEvent({
              dossierId: input.folderId,
              articleCount: input.articles.length,
              model: "deterministic_fallback",
              durationMs: inferenceDurationMs,
              decision: fallback.decision,
              decisionMethod: "deterministic_fallback",
              channelHint: fallback.channelHint,
              attemptNumber: recorded.attemptNumber,
            }),
          );

          return {
            kind: "created",
            attemptId: recorded.id,
            folderId: input.folderId,
            aggregateFingerprint: fingerprint,
            decision: fallback.decision,
            analysis,
            channelHint: fallback.channelHint,
            attemptNumber: recorded.attemptNumber,
            decisionMethod: "deterministic_fallback",
          };
        }

        const errorCodes: AnalysisErrorCode[] = [inference.errorCode];
        if (inference.attempts >= OLLAMA_MAX_ATTEMPTS) {
          errorCodes.push("analysis_exhausted");
        }
        return persistFailure({
          persistence,
          clock,
          folderId: input.folderId,
          fingerprint,
          modelId: expectedModelId,
          errorCodes,
          analyzedAt,
          attemptNumber,
          articleIds,
          sourceIds,
          logger,
          ollamaBaseUrl,
          expectedModelId,
          failureDetail,
          skipLog: true,
        });
      }

      if (inference.modelId !== expectedModelId) {
        const failureDetail: AnalysisFailureDetail = {
          stage: "request",
          errorCode: "model_mismatch",
          message: `model mismatch: got ${inference.modelId}, expected ${expectedModelId}`,
          retryable: false,
          attemptNumber,
          durationMs: inferenceDurationMs,
          model: inference.modelId,
          ollamaBaseUrl,
        };
        return persistFailure({
          persistence,
          clock,
          folderId: input.folderId,
          fingerprint,
          modelId: inference.modelId,
          errorCodes: ["model_mismatch"],
          analyzedAt,
          attemptNumber,
          articleIds,
          sourceIds,
          logger,
          ollamaBaseUrl,
          expectedModelId,
          failureDetail,
        });
      }

      const factResult = validateAndAnchorFacts({
        proposedFacts: inference.proposal.proposedFacts,
        aggregateText: context.aggregateAnchorText,
        folderTitle: input.folder.title,
      });
      const entityResult = deduplicateEntities(inference.proposal.entities);

      const warnings = [
        ...factResult.warnings,
        ...entityResult.warnings,
      ].slice(0, 20);

      const proposal: AnalysisProposalV1 = {
        ...inference.proposal,
        entities: entityResult.entities,
        proposedFacts: factResult.retainedFacts,
      };

      const validationStatus =
        warnings.length === 0 ? "accepted" : "accepted_with_warnings";

      const backendScoring = computeBackendScoring({
        relevance: proposal.scoring.relevance,
        impact: proposal.scoring.impact,
        novelty: proposal.scoring.novelty,
        confidence: proposal.scoring.confidence,
        bestSourceTier,
      });

      const { decision } = decidePublication({
        validationStatus,
        composite: backendScoring.composite,
        publishWorthiness: proposal.editorialProposal.publishWorthiness,
        hasMainPublication: input.hasMainPublication,
        isMaterialEnrichReanalysis: materialEnrichReanalysis,
        anchoredFactCount: factResult.retainedFacts.length,
        priorHoldCount: priorHolds,
      });

      const channelHint = mapChannelSalonHint({
        composite: backendScoring.composite,
        effectiveImpact: backendScoring.effectiveImpact,
        primaryCategory: proposal.classification.primaryCategory,
        suggestedChannelRole:
          proposal.editorialProposal.suggestedChannelRole,
      });

      const analysis: ValidatedAnalysisV1 = {
        schemaVersion: "1",
        folderId: input.folderId,
        analyzedAt: toIso(analyzedAt),
        modelId: inference.modelId,
        proposalOrigin: "llm_analysis",
        aggregateFingerprint: fingerprint,
        proposal,
        validation: {
          status: validationStatus,
          warnings,
          droppedFacts: factResult.droppedFacts,
        },
        backendScoring,
      };

      const recorded = await recordAttemptWithConflictRetry(
        persistence,
        input.folderId,
        fingerprint,
        (allocatedNumber) => ({
          folderId: input.folderId,
          aggregateFingerprint: fingerprint,
          attemptNumber: allocatedNumber,
          analyzedAt,
          modelId: inference.modelId,
          proposalOrigin: "llm_analysis" as const,
          validationStatus,
          proposal,
          backendScoring,
          warnings,
          droppedFacts: factResult.droppedFacts,
          publicationDecision: decision,
          schemaVersion: "1" as const,
        }),
      );

      logger?.info(
        "analysis.succeeded",
        buildAnalysisSucceededEvent({
          dossierId: input.folderId,
          articleCount: input.articles.length,
          model: inference.modelId,
          durationMs: inferenceDurationMs,
          decision,
          decisionMethod: "llm_analysis",
          channelHint,
          attemptNumber: recorded.attemptNumber,
        }),
      );

      return {
        kind: "created",
        attemptId: recorded.id,
        folderId: input.folderId,
        aggregateFingerprint: fingerprint,
        decision,
        analysis,
        channelHint,
        attemptNumber: recorded.attemptNumber,
        decisionMethod: "llm_analysis",
      };
    },
  };
}

async function recordAttemptWithConflictRetry(
  persistence: AnalysisAttemptPersistence,
  folderId: string,
  fingerprint: string,
  build: (
    attemptNumber: number,
  ) => Parameters<AnalysisAttemptPersistence["recordAnalysisAttempt"]>[0],
): Promise<Awaited<ReturnType<AnalysisAttemptPersistence["recordAnalysisAttempt"]>>> {
  let lastError: unknown;
  for (let i = 0; i < 5; i += 1) {
    const attemptNumber =
      (await persistence.countAttemptsForFingerprint(folderId, fingerprint)) + 1;
    try {
      return await persistence.recordAnalysisAttempt(build(attemptNumber));
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (
        !/unique|duplicate|attemptNumber/i.test(message) ||
        i === 4
      ) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("failed to allocate analysis attemptNumber");
}

async function persistSkip(args: {
  persistence: AnalysisAttemptPersistence;
  clock: AnalysisServiceClock;
  folderId: string;
  fingerprint: string;
  reason: "not_eligible" | "enrichment_immaterial";
}): Promise<AnalysisServiceResult> {
  const analyzedAt = args.clock.now();
  const recorded = await recordAttemptWithConflictRetry(
    args.persistence,
    args.folderId,
    args.fingerprint,
    (attemptNumber) => ({
      folderId: args.folderId,
      aggregateFingerprint: args.fingerprint,
      attemptNumber,
      analyzedAt,
      modelId: null,
      validationStatus: "rejected" as const,
      proposal: null,
      backendScoring: null,
      errorCodes: [args.reason],
      warnings: [],
      droppedFacts: [],
      publicationDecision: null,
      schemaVersion: "1" as const,
    }),
  );

  return {
    kind: "skipped",
    attemptId: recorded.id,
    folderId: args.folderId,
    aggregateFingerprint: args.fingerprint,
    reason: args.reason,
    attemptNumber: recorded.attemptNumber,
  };
}

async function persistFailure(args: {
  persistence: AnalysisAttemptPersistence;
  clock: AnalysisServiceClock;
  folderId: string;
  fingerprint: string;
  modelId: string | null;
  errorCodes: readonly AnalysisErrorCode[];
  analyzedAt?: Date;
  attemptNumber?: number;
  articleIds: readonly string[];
  sourceIds: readonly string[];
  logger?: AnalysisServiceLogger;
  ollamaBaseUrl: string;
  expectedModelId: string;
  failureDetail?: AnalysisFailureDetail;
  skipLog?: boolean;
}): Promise<AnalysisServiceResult> {
  const analyzedAt = args.analyzedAt ?? args.clock.now();
  let recorded: Awaited<
    ReturnType<AnalysisAttemptPersistence["recordAnalysisAttempt"]>
  >;
  try {
    recorded = await recordAttemptWithConflictRetry(
      args.persistence,
      args.folderId,
      args.fingerprint,
      (attemptNumber) => ({
        folderId: args.folderId,
        aggregateFingerprint: args.fingerprint,
        attemptNumber: args.attemptNumber ?? attemptNumber,
        analyzedAt,
        modelId: args.modelId,
        validationStatus: "rejected" as const,
        proposal: null,
        backendScoring: null,
        errorCodes: args.errorCodes,
        warnings: [],
        droppedFacts: [],
        publicationDecision: "hold" as const,
        schemaVersion: "1" as const,
      }),
    );
  } catch (error) {
    const detail: AnalysisFailureDetail = {
      stage: "persistence",
      errorCode: "persistence_failed",
      message: error instanceof Error ? error.message : "persistence failed",
      retryable: true,
      attemptNumber: args.attemptNumber ?? 1,
      durationMs: args.failureDetail?.durationMs ?? 0,
      model: args.expectedModelId,
      ollamaBaseUrl: args.ollamaBaseUrl,
    };
    emitAnalysisFailed(
      args.logger,
      buildAnalysisFailedEvent({
        dossierId: args.folderId,
        articleIds: args.articleIds,
        sourceIds: args.sourceIds,
        model: args.expectedModelId,
        ollamaBaseUrl: args.ollamaBaseUrl,
        detail,
      }),
    );
    throw error;
  }

  if (!args.skipLog && args.failureDetail) {
    emitAnalysisFailed(
      args.logger,
      buildAnalysisFailedEvent({
        dossierId: args.folderId,
        articleIds: args.articleIds,
        sourceIds: args.sourceIds,
        model: args.expectedModelId,
        ollamaBaseUrl: args.ollamaBaseUrl,
        detail: args.failureDetail,
      }),
    );
  }

  const analysis: ValidatedAnalysisV1 = {
    schemaVersion: "1",
    folderId: args.folderId,
    analyzedAt: toIso(analyzedAt),
    modelId: args.modelId ?? "",
    proposalOrigin: "llm_analysis",
    aggregateFingerprint: args.fingerprint,
    validation: {
      status: "rejected",
      warnings: [],
      droppedFacts: [],
    },
  };

  return {
    kind: "failed",
    attemptId: recorded.id,
    folderId: args.folderId,
    aggregateFingerprint: args.fingerprint,
    decision: "hold",
    errorCodes: args.errorCodes,
    analysis,
    attemptNumber: recorded.attemptNumber,
    failureDetail: args.failureDetail,
  };
}
