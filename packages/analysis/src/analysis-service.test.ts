import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { computeAggregateFingerprint } from "./aggregate-fingerprint.js";
import { createAnalysisService } from "./analysis-service.js";
import type {
  AnalysisAttemptPersistence,
  AnalysisArticleInput,
  AnalyzeFolderInput,
  BackendScoringV1,
} from "./analysis-service-types.js";
import type { AnalysisProposalV1 } from "./analysis-proposal-types.js";

const VALID_SUMMARY =
  "OpenAI annonce une nouvelle version de son modèle phare avec des gains mesurables.";

function validProposal(
  overrides: Partial<AnalysisProposalV1> = {},
): AnalysisProposalV1 {
  return {
    schemaVersion: "1",
    summary: VALID_SUMMARY,
    classification: {
      primaryCategory: "model_release",
      secondaryCategories: [],
      announcementNature: "launch",
    },
    scoring: {
      relevance: 80,
      impact: 75,
      novelty: 70,
      confidence: 0.8,
    },
    entities: ["OpenAI"],
    proposedFacts: [
      { key: "model", value: "GPT-5", support: "explicit" },
    ],
    editorialProposal: {
      publishWorthiness: "medium",
      suggestedChannelRole: "veille_pertinente",
    },
    rationale: "Annonce claire.",
    ...overrides,
  };
}

function article(
  partial: Partial<AnalysisArticleInput> &
    Pick<AnalysisArticleInput, "articleId" | "role">,
): AnalysisArticleInput {
  return {
    sourceTier: "B",
    title: "OpenAI GPT-5 launch",
    url: `https://example.com/${partial.articleId}`,
    summary: "OpenAI releases GPT-5.",
    content: "OpenAI releases GPT-5 with improved reasoning.",
    attachedAt: "2026-07-01T00:00:00.000Z",
    ...partial,
  };
}

function baseInput(
  overrides: Partial<AnalyzeFolderInput> = {},
): AnalyzeFolderInput {
  return {
    folderId: "folder-1",
    folder: { id: "folder-1", status: "open", title: "OpenAI GPT-5 launch" },
    articles: [article({ articleId: "a1", role: "primary" })],
    enrichmentFacts: [],
    triggerIssue: "create_dossier",
    hasMainPublication: false,
    ...overrides,
  };
}

type StoredAttempt = Awaited<
  ReturnType<AnalysisAttemptPersistence["recordAnalysisAttempt"]>
>;

function createMemoryPersistence(): AnalysisAttemptPersistence & {
  attempts: StoredAttempt[];
} {
  const attempts: StoredAttempt[] = [];
  let seq = 0;

  return {
    attempts,
    async recordAnalysisAttempt(input) {
      seq += 1;
      const row: StoredAttempt = {
        id: `att-${seq}`,
        folderId: input.folderId,
        aggregateFingerprint: input.aggregateFingerprint,
        attemptNumber: input.attemptNumber,
        analyzedAt: input.analyzedAt ?? new Date("2026-07-16T12:00:00.000Z"),
        modelId: input.modelId ?? null,
        proposalOrigin: "llm",
        validationStatus: input.validationStatus,
        proposal: input.proposal ?? null,
        backendScoring: (input.backendScoring ?? null) as BackendScoringV1 | null,
        errorCodes: input.errorCodes ? [...input.errorCodes] : [],
        warnings: input.warnings ? [...input.warnings] : [],
        droppedFacts: input.droppedFacts ? [...input.droppedFacts] : [],
        publicationDecision: input.publicationDecision ?? null,
        createdAt: new Date("2026-07-16T12:00:00.000Z"),
      };
      attempts.push(row);
      return row;
    },
    async getLatestAcceptedAnalysisForFingerprint(folderId, fingerprint) {
      const match = [...attempts]
        .reverse()
        .find(
          (a) =>
            a.folderId === folderId &&
            a.aggregateFingerprint === fingerprint &&
            (a.validationStatus === "accepted" ||
              a.validationStatus === "accepted_with_warnings"),
        );
      return match ?? null;
    },
    async countAttemptsForFingerprint(folderId, fingerprint) {
      return attempts.filter(
        (a) =>
          a.folderId === folderId && a.aggregateFingerprint === fingerprint,
      ).length;
    },
    async countHoldDecisionsForFingerprint(folderId, fingerprint) {
      return attempts.filter(
        (a) =>
          a.folderId === folderId &&
          a.aggregateFingerprint === fingerprint &&
          a.publicationDecision === "hold",
      ).length;
    },
  };
}

describe("createAnalysisService", () => {
  it("46+50+54. complete success with typed result and persistence", async () => {
    const persistence = createMemoryPersistence();
    const infer = vi.fn(async () => ({
      ok: true as const,
      proposal: validProposal(),
      rawText: "{}",
      modelId: "ministral-3-3b",
      attempts: 1,
    }));

    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence,
      expectedModelId: "ministral-3-3b",
      clock: { now: () => new Date("2026-07-16T12:00:00.000Z") },
    });

    const result = await service.analyze(baseInput());
    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.decision).toBe("publish");
    expect(result.analysis.validation.status).toMatch(/^accepted/);
    expect(result.analysis.backendScoring).toBeDefined();
    expect(result.aggregateFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(persistence.attempts).toHaveLength(1);
    expect(persistence.attempts[0]!.publicationDecision).toBe("publish");
    expect(infer).toHaveBeenCalledTimes(1);
  });

  it("12. reuses accepted analysis for same fingerprint", async () => {
    const persistence = createMemoryPersistence();
    const infer = vi.fn(async () => ({
      ok: true as const,
      proposal: validProposal(),
      rawText: "{}",
      modelId: "ministral-3-3b",
      attempts: 1,
    }));
    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence,
      expectedModelId: "ministral-3-3b",
    });

    const first = await service.analyze(baseInput());
    expect(first.kind).toBe("created");
    const second = await service.analyze(baseInput());
    expect(second.kind).toBe("reused");
    expect(infer).toHaveBeenCalledTimes(1);
    expect(persistence.attempts).toHaveLength(1);
  });

  it("8 path: create_dossier analyzed; 9: duplicate skipped without Ollama", async () => {
    const persistence = createMemoryPersistence();
    const infer = vi.fn();
    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence,
      expectedModelId: "ministral-3-3b",
    });

    const skipped = await service.analyze(
      baseInput({ triggerIssue: "duplicate_editorial" }),
    );
    expect(skipped.kind).toBe("skipped");
    if (skipped.kind !== "skipped") return;
    expect(skipped.reason).toBe("not_eligible");
    expect(infer).not.toHaveBeenCalled();
    expect(persistence.attempts[0]!.errorCodes).toContain("not_eligible");
  });

  it("21. context_too_large does not call Ollama", async () => {
    const persistence = createMemoryPersistence();
    const infer = vi.fn();
    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence,
      expectedModelId: "ministral-3-3b",
    });

    const manyArticles = Array.from({ length: 100 }, (_, i) =>
      article({
        articleId: `id-${i}-${"z".repeat(50)}`,
        role: i === 0 ? "primary" : "enrichment",
        title: `Title-${"t".repeat(100)}-${i}`,
        url: `https://example.com/${"u".repeat(100)}/${i}`,
        content: "",
        attachedAt: new Date(Date.UTC(2026, 0, (i % 28) + 1)).toISOString(),
      }),
    );

    const result = await service.analyze(
      baseInput({
        articles: manyArticles,
        folder: {
          id: "folder-1",
          status: "open",
          title: "T".repeat(800),
        },
      }),
    );

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.errorCodes).toContain("context_too_large");
    expect(infer).not.toHaveBeenCalled();
  });

  it("47+49. invalid JSON from client is persisted as failure", async () => {
    const persistence = createMemoryPersistence();
    const infer = vi.fn(async () => ({
      ok: false as const,
      errorCode: "invalid_json" as const,
      message: "bad json",
      attempts: 3,
    }));
    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence,
      expectedModelId: "ministral-3-3b",
    });

    const result = await service.analyze(baseInput());
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.errorCodes).toContain("invalid_json");
    expect(result.errorCodes).toContain("analysis_exhausted");
    expect(result.decision).toBe("hold");
    expect(persistence.attempts).toHaveLength(1);
    expect(persistence.attempts[0]!.validationStatus).toBe("rejected");
    expect(persistence.attempts[0]!.proposal).toBeNull();
  });

  it("48. timeout / unavailable persisted", async () => {
    const persistence = createMemoryPersistence();
    const infer = vi.fn(async () => ({
      ok: false as const,
      errorCode: "ollama_unavailable" as const,
      message: "down",
      attempts: 3,
    }));
    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence,
      expectedModelId: "ministral-3-3b",
    });

    const result = await service.analyze(baseInput());
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.errorCodes).toContain("ollama_unavailable");
  });

  it("emits structured analysis.failed with stage/model/message", async () => {
    const persistence = createMemoryPersistence();
    const warn = vi.fn();
    const info = vi.fn();
    const infer = vi.fn(async () => ({
      ok: false as const,
      errorCode: "ollama_unavailable" as const,
      message: "connect ECONNREFUSED 127.0.0.1:11434",
      attempts: 3,
      stage: "transport" as const,
      statusCode: 0,
      retryable: true,
      logErrorCode: "server_unreachable",
      durationMs: 42,
    }));
    const service = createAnalysisService({
      ollamaClient: {
        infer,
        baseUrl: "http://127.0.0.1:11434",
        model: "ministral-3:3b",
      },
      persistence,
      expectedModelId: "ministral-3:3b",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      logger: { info, warn },
    });

    const result = await service.analyze(baseInput());
    expect(result.kind).toBe("failed");
    expect(warn).toHaveBeenCalledWith(
      "analysis.failed",
      expect.objectContaining({
        event: "analysis.failed",
        stage: "transport",
        model: "ministral-3:3b",
        errorCode: "server_unreachable",
        message: expect.stringMatching(/ECONNREFUSED/),
        statusCode: 0,
        retryable: true,
        ollamaBaseUrl: "http://127.0.0.1:11434",
      }),
    );
    if (result.kind === "failed") {
      expect(result.failureDetail?.stage).toBe("transport");
      expect(result.failureDetail?.errorCode).toBe("server_unreachable");
    }
  });

  it("51. attempt number increments correctly", async () => {
    const persistence = createMemoryPersistence();
    const infer = vi.fn(async () => ({
      ok: false as const,
      errorCode: "inference_timeout" as const,
      message: "timeout",
      attempts: 3,
    }));
    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence,
      expectedModelId: "ministral-3-3b",
    });

    const first = await service.analyze(baseInput());
    const second = await service.analyze(baseInput());
    expect(first.kind).toBe("failed");
    expect(second.kind).toBe("failed");
    if (first.kind !== "failed" || second.kind !== "failed") return;
    expect(first.attemptNumber).toBe(1);
    expect(second.attemptNumber).toBe(2);
  });

  it("52. no double persistence on success", async () => {
    const persistence = createMemoryPersistence();
    const infer = vi.fn(async () => ({
      ok: true as const,
      proposal: validProposal(),
      rawText: "{}",
      modelId: "ministral-3-3b",
      attempts: 1,
    }));
    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence,
      expectedModelId: "ministral-3-3b",
    });
    await service.analyze(baseInput());
    expect(persistence.attempts).toHaveLength(1);
  });

  it("53. does not add a second retry strategy (single infer call)", async () => {
    const persistence = createMemoryPersistence();
    const infer = vi.fn(async () => ({
      ok: false as const,
      errorCode: "schema_violation" as const,
      message: "bad",
      attempts: 3,
    }));
    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence,
      expectedModelId: "ministral-3-3b",
    });
    await service.analyze(baseInput());
    expect(infer).toHaveBeenCalledTimes(1);
  });

  it("55. package surface has no Fastify / Discord imports", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const srcDir = path.dirname(fileURLToPath(import.meta.url));
    const files = fs
      .readdirSync(srcDir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    for (const file of files) {
      const content = fs.readFileSync(path.join(srcDir, file), "utf8");
      expect(content).not.toMatch(/from ["']fastify["']/);
      expect(content).not.toMatch(/discord\.js/);
      expect(content).not.toMatch(/from ["']discord/);
    }
  });

  it("fingerprint helper stays aligned with service input", () => {
    const input = baseInput();
    const fp = computeAggregateFingerprint({
      folderId: input.folderId,
      articleIds: input.articles.map((a) => a.articleId),
      enrichmentFacts: input.enrichmentFacts,
      folderStatus: input.folder.status,
    });
    expect(fp).toHaveLength(64);
    expect(createHash("sha256").update("x").digest("hex")).toHaveLength(64);
  });

  it("model_mismatch yields hold without treating as success", async () => {
    const persistence = createMemoryPersistence();
    const infer = vi.fn(async () => ({
      ok: true as const,
      proposal: validProposal(),
      rawText: "{}",
      modelId: "other-model",
      attempts: 1,
    }));
    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence,
      expectedModelId: "ministral-3-3b",
    });
    const result = await service.analyze(baseInput());
    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.errorCodes).toContain("model_mismatch");
  });

  it("gel §17 O: 2 prior holds then composite 60 → reject_editorial", async () => {
    const persistence = createMemoryPersistence();
    const borderline = validProposal({
      scoring: {
        relevance: 60,
        impact: 60,
        novelty: 60,
        confidence: 0.7,
      },
      editorialProposal: {
        publishWorthiness: "medium",
        suggestedChannelRole: "veille_pertinente",
      },
      proposedFacts: [],
    });
    const infer = vi.fn(async () => ({
      ok: true as const,
      proposal: borderline,
      rawText: "{}",
      modelId: "ministral-3-3b",
      attempts: 1,
    }));
    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence,
      expectedModelId: "ministral-3-3b",
      clock: { now: () => new Date("2026-07-16T12:00:00.000Z") },
    });

    const first = await service.analyze(baseInput());
    expect(first.kind).toBe("created");
    if (first.kind !== "created") return;
    expect(first.decision).toBe("hold");
    expect(first.analysis.backendScoring?.composite).toBe(60);

    const second = await service.analyze(baseInput());
    expect(second.kind).toBe("created");
    if (second.kind !== "created") return;
    expect(second.decision).toBe("hold");

    const third = await service.analyze(baseInput());
    expect(third.kind).toBe("created");
    if (third.kind !== "created") return;
    expect(third.decision).toBe("reject_editorial");
    expect(infer).toHaveBeenCalledTimes(3);
    expect(persistence.attempts).toHaveLength(3);
    expect(persistence.attempts[2]!.publicationDecision).toBe(
      "reject_editorial",
    );

    const fourth = await service.analyze(baseInput());
    expect(fourth.kind).toBe("reused");
    if (fourth.kind !== "reused") return;
    expect(fourth.decision).toBe("reject_editorial");
    expect(infer).toHaveBeenCalledTimes(3);
  });
});
