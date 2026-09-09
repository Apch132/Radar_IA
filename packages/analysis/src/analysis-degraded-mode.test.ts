import { describe, expect, it, vi } from "vitest";

import { createAnalysisService } from "./analysis-service.js";
import type {
  AnalysisAttemptPersistence,
  AnalysisErrorCode,
} from "./analysis-service-types.js";

function persistence(): AnalysisAttemptPersistence {
  const attempts: Array<Record<string, unknown>> = [];
  return {
    async recordAnalysisAttempt(input) {
      const row = {
        id: `attempt-${attempts.length + 1}`,
        ...input,
        analyzedAt: input.analyzedAt ?? new Date(),
        modelId: input.modelId ?? null,
        proposalOrigin: input.proposalOrigin ?? "llm_analysis",
        proposal: input.proposal ?? null,
        backendScoring: input.backendScoring ?? null,
        errorCodes: [...(input.errorCodes ?? [])] as AnalysisErrorCode[],
        warnings: [...(input.warnings ?? [])],
        droppedFacts: [...(input.droppedFacts ?? [])],
        publicationDecision: input.publicationDecision ?? null,
        createdAt: new Date(),
      };
      attempts.push(row);
      return row as never;
    },
    async getLatestAcceptedAnalysisForFingerprint() {
      return null;
    },
    async countAttemptsForFingerprint() {
      return attempts.length;
    },
    async countHoldDecisionsForFingerprint() {
      return 0;
    },
  };
}

function input(title = "Introducing Qwen3, our new model") {
  return {
    folderId: "folder-1",
    folder: { id: "folder-1", status: "open" as const, title },
    articles: [{
      articleId: "article-1",
      role: "primary" as const,
      sourceId: "qwen-blog",
      sourceTier: "S" as const,
      title,
      url: "https://example.test/qwen3",
      attachedAt: "2026-07-01T00:00:00.000Z",
    }],
    enrichmentFacts: [],
    triggerIssue: "create_dossier" as const,
    hasMainPublication: false,
  };
}

function failure(errorCode: "ollama_unavailable" | "inference_timeout" | "invalid_json" | "schema_violation") {
  return vi.fn(async () => ({
    ok: false as const,
    errorCode,
    message: errorCode,
    attempts: 1,
  }));
}

describe("analysis degraded mode", () => {
  it.each([
    "ollama_unavailable",
    "inference_timeout",
    "invalid_json",
    "schema_violation",
  ] as const)("falls back after %s for a Tier S major announcement", async (errorCode) => {
    const infer = failure(errorCode);
    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence: persistence(),
      expectedModelId: "missing-model",
    });
    const result = await service.analyze(input());
    expect(result).toMatchObject({
      kind: "created",
      decision: "publish",
      decisionMethod: "deterministic_fallback",
      analysis: { proposalOrigin: "deterministic_fallback" },
    });
  });

  it("does not fall back for a non-major Tier S item", async () => {
    const service = createAnalysisService({
      ollamaClient: { infer: failure("ollama_unavailable") },
      persistence: persistence(),
      expectedModelId: "missing-model",
    });
    const result = await service.analyze(input("Weekly community links"));
    expect(result.kind).toBe("failed");
  });

  it("marks successful inference as LLM analysis", async () => {
    const service = createAnalysisService({
      ollamaClient: {
        infer: vi.fn(async () => ({
          ok: true as const,
          modelId: "model",
          rawText: "{}",
          attempts: 1,
          proposal: {
            schemaVersion: "1" as const,
            summary: "Qwen3 is now available with improved reasoning performance.",
            classification: { primaryCategory: "model_release" as const, secondaryCategories: [], announcementNature: "launch" as const },
            scoring: { relevance: 90, impact: 90, novelty: 90, confidence: 0.9 },
            entities: ["Qwen"],
            proposedFacts: [],
            editorialProposal: { publishWorthiness: "high" as const, suggestedChannelRole: "annonces_majeures" as const },
            rationale: "Official announcement.",
          },
        })),
      },
      persistence: persistence(),
      expectedModelId: "model",
    });
    // Non-Critical title so the pre-LLM short-circuit does not skip Ollama.
    const result = await service.analyze(input("Qwen team notes on tokenizer experiments"));
    expect(result).toMatchObject({ kind: "created", decisionMethod: "llm_analysis" });
  });
});
