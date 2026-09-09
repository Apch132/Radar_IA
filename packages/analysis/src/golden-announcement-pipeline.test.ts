import { describe, expect, it, vi } from "vitest";

import { createAnalysisService } from "./analysis-service.js";
import type {
  AnalysisAttemptPersistence,
  AnalysisErrorCode,
} from "./analysis-service-types.js";
import { evaluateImportance } from "./importance-evaluation.js";
import { isOfficialWhitelistSource } from "./official-whitelist.js";

type GoldenCase = {
  readonly name: string;
  readonly sourceId: string;
  readonly sourceTier: "S" | "A";
  readonly title: string;
  readonly expectedLevel: "critical" | "high";
};

const GOLDEN_ANNOUNCEMENTS: readonly GoldenCase[] = [
  {
    name: "Claude Opus 5",
    sourceId: "anthropic-news",
    sourceTier: "A",
    title: "Announcing Claude Opus 5, our most capable model",
    expectedLevel: "critical",
  },
  {
    name: "GPT majeur",
    sourceId: "openai-news",
    sourceTier: "S",
    title: "Introducing GPT-5.2 — now generally available",
    expectedLevel: "critical",
  },
  {
    name: "Gemini majeur",
    sourceId: "google-deepmind",
    sourceTier: "S",
    title: "Launching Gemini 3 Pro for developers",
    expectedLevel: "critical",
  },
  {
    name: "Mistral majeur",
    sourceId: "mistral-news",
    sourceTier: "A",
    title: "Announcing Mistral Large 3 — frontier open model",
    expectedLevel: "critical",
  },
  {
    name: "Cursor",
    sourceId: "cursor-blog",
    sourceTier: "S",
    title: "Announcing Cursor 2.0 — now available",
    expectedLevel: "critical",
  },
  {
    name: "Qwen",
    sourceId: "qwen-blog",
    sourceTier: "S",
    title: "Announcing Qwen3, our new model family",
    expectedLevel: "critical",
  },
];

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

function folderInput(caseItem: GoldenCase) {
  return {
    folderId: `folder-${caseItem.sourceId}`,
    folder: {
      id: `folder-${caseItem.sourceId}`,
      status: "open" as const,
      title: caseItem.title,
    },
    articles: [
      {
        articleId: `article-${caseItem.sourceId}`,
        role: "primary" as const,
        sourceId: caseItem.sourceId,
        sourceTier: caseItem.sourceTier,
        title: caseItem.title,
        url: `https://fixtures.test/${caseItem.sourceId}`,
        attachedAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    enrichmentFacts: [],
    triggerIssue: "create_dossier" as const,
    hasMainPublication: false,
  };
}

describe("golden announcement pipeline (Correctif 2)", () => {
  it.each(GOLDEN_ANNOUNCEMENTS)(
    "$name is official whitelist + critical importance",
    (caseItem) => {
      expect(isOfficialWhitelistSource(caseItem.sourceId)).toBe(true);
      const importance = evaluateImportance({
        articles: folderInput(caseItem).articles,
        folderTitle: caseItem.title,
      });
      expect(importance.level).toBe(caseItem.expectedLevel);
      expect(importance.signals).toEqual(
        expect.arrayContaining(["official_publisher"]),
      );
    },
  );

  it.each(GOLDEN_ANNOUNCEMENTS)(
    "$name: Critical short-circuits before LLM and publishes",
    async (caseItem) => {
      const infer = vi.fn(async () => {
        throw new Error("Ollama must not be called for Critical short-circuit");
      });
      const service = createAnalysisService({
        ollamaClient: { infer },
        persistence: persistence(),
        expectedModelId: "ministral-3:3b",
      });

      const result = await service.analyze(folderInput(caseItem));
      expect(infer).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        kind: "created",
        decision: "publish",
        decisionMethod: "deterministic_fallback",
        channelHint: expect.stringMatching(
          /annonces_majeures|veille_pertinente/,
        ),
      });
    },
  );

  it("Ollama unavailable → fallback → publication for official introducing phrase", async () => {
    const infer = vi.fn(async () => ({
      ok: false as const,
      errorCode: "ollama_unavailable" as const,
      message: "connection refused",
      attempts: 3,
      stage: "transport" as const,
      retryable: true,
    }));

    const majorTitle = "Introducing our new Codex agent for developers";

    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence: persistence(),
      expectedModelId: "ministral-3:3b",
    });

    const input = {
      folderId: "folder-fallback",
      folder: {
        id: "folder-fallback",
        status: "open" as const,
        title: majorTitle,
      },
      articles: [
        {
          articleId: "article-fallback",
          role: "primary" as const,
          sourceId: "openai-news",
          sourceTier: "S" as const,
          title: majorTitle,
          url: "https://fixtures.test/openai-fallback",
          attachedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
      enrichmentFacts: [],
      triggerIssue: "create_dossier" as const,
      hasMainPublication: false,
    };

    const importance = evaluateImportance({
      articles: input.articles,
      folderTitle: majorTitle,
    });

    const result = await service.analyze(input);
    expect(result).toMatchObject({
      kind: "created",
      decision: "publish",
      decisionMethod: "deterministic_fallback",
    });

    if (importance.level === "critical") {
      expect(infer).not.toHaveBeenCalled();
    } else {
      expect(infer).toHaveBeenCalledOnce();
    }
  });

  it("Ollama down cannot silence a Critical Claude Opus announcement", async () => {
    const infer = vi.fn(async () => ({
      ok: false as const,
      errorCode: "ollama_unavailable" as const,
      message: "down",
      attempts: 3,
    }));
    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence: persistence(),
      expectedModelId: "ministral-3:3b",
    });
    const result = await service.analyze(
      folderInput(GOLDEN_ANNOUNCEMENTS[0]!),
    );
    expect(result).toMatchObject({
      kind: "created",
      decision: "publish",
      decisionMethod: "deterministic_fallback",
    });
    expect(infer).not.toHaveBeenCalled();
  });
});
