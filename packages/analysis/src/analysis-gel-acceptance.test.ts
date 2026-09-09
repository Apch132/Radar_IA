/**
 * Matrice de traçabilité gel 007.1A §17 (critères A–O).
 * Couverture unitaire / service déjà présente ailleurs ; ce fichier
 * ancre explicitement chaque critère pour la clôture 007.1F.
 */
import { describe, expect, it, vi } from "vitest";

import { decidePublication, mapChannelSalonHint } from "./analysis-decision.js";
import { evaluateEligibility } from "./analysis-eligibility.js";
import { validateAndAnchorFacts } from "./analysis-fact-validation.js";
import { createAnalysisService } from "./analysis-service.js";
import type {
  AnalysisAttemptPersistence,
  AnalyzeFolderInput,
  BackendScoringV1,
} from "./analysis-service-types.js";
import type { AnalysisProposalV1 } from "./analysis-proposal-types.js";
import { createOllamaAnalysisClient } from "./ollama-client.js";
import type { FetchLike } from "./ollama-client.js";

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
    proposedFacts: [{ key: "model", value: "GPT-5", support: "explicit" }],
    editorialProposal: {
      publishWorthiness: "medium",
      suggestedChannelRole: "veille_pertinente",
    },
    rationale: "Annonce claire.",
    ...overrides,
  };
}

function baseInput(
  overrides: Partial<AnalyzeFolderInput> = {},
): AnalyzeFolderInput {
  return {
    folderId: "folder-1",
    folder: { id: "folder-1", status: "open", title: "OpenAI GPT-5 launch" },
    articles: [
      {
        articleId: "a1",
        role: "primary",
        sourceTier: "B",
        title: "OpenAI GPT-5 launch",
        url: "https://example.com/a1",
        summary: "OpenAI releases GPT-5.",
        content: "OpenAI releases GPT-5 with improved reasoning.",
        attachedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
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
      return (
        [...attempts]
          .reverse()
          .find(
            (a) =>
              a.folderId === folderId &&
              a.aggregateFingerprint === fingerprint &&
              (a.validationStatus === "accepted" ||
                a.validationStatus === "accepted_with_warnings"),
          ) ?? null
      );
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

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("gel 007.1A §17 acceptance matrix (007.1F)", () => {
  it("A — create_dossier + composite 75 + worthiness medium → publish", async () => {
    const persistence = createMemoryPersistence();
    const service = createAnalysisService({
      ollamaClient: {
        infer: async () => ({
          ok: true as const,
          proposal: validProposal(),
          rawText: "{}",
          modelId: "ministral-3-3b",
          attempts: 1,
        }),
      },
      persistence,
      expectedModelId: "ministral-3-3b",
    });
    const result = await service.analyze(baseInput());
    expect(result.kind).toBe("created");
    if (result.kind !== "created") return;
    expect(result.analysis.backendScoring?.composite).toBeGreaterThanOrEqual(70);
    expect(result.decision).toBe("publish");
  });

  it("B — duplicate_editorial → 0 inférence", () => {
    expect(
      evaluateEligibility(
        baseInput({ triggerIssue: "duplicate_editorial" }),
        "B",
      ).eligible,
    ).toBe(false);
  });

  it("C — JSON invalide ×3 → analysis_exhausted (client)", async () => {
    let calls = 0;
    const fetchMock: FetchLike = vi.fn(async () => {
      calls += 1;
      return jsonResponse({ response: "not-json" });
    });
    const client = createOllamaAnalysisClient({
      config: { baseUrl: "http://ollama.test", model: "ministral-3-3b" },
      fetch: fetchMock,
      sleep: async () => undefined,
    });
    const result = await client.infer({ prompt: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("invalid_json");
    expect(result.attempts).toBe(3);
    expect(calls).toBe(3);
  });

  it("D — worthiness high + composite 50 → pas publish", () => {
    expect(
      decidePublication({
        validationStatus: "accepted",
        composite: 50,
        publishWorthiness: "high",
        hasMainPublication: false,
        isMaterialEnrichReanalysis: false,
        anchoredFactCount: 0,
        priorHoldCount: 0,
      }).decision,
    ).not.toBe("publish");
  });

  it("E — hint annonces_majeures + composite 72 → salon veille", () => {
    expect(
      mapChannelSalonHint({
        composite: 72,
        effectiveImpact: 50,
        primaryCategory: "other",
        suggestedChannelRole: "annonces_majeures",
      }),
    ).toBe("veille_pertinente");
  });

  it("F — 2 analyses concurrentes → sérialisation (concurrency = 1)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock: FetchLike = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight -= 1;
      return jsonResponse({
        model: "ministral-3-3b",
        response: JSON.stringify(validProposal()),
      });
    });
    const client = createOllamaAnalysisClient({
      config: { baseUrl: "http://ollama.test", model: "ministral-3-3b" },
      fetch: fetchMock,
      sleep: async () => undefined,
    });
    await Promise.all([
      client.infer({ prompt: "a" }),
      client.infer({ prompt: "b" }),
    ]);
    expect(maxInFlight).toBe(1);
  });

  it("G — fait non ancré → droppedFacts", () => {
    const result = validateAndAnchorFacts({
      proposedFacts: [
        { key: "secret", value: "valeur-absente-xyz", support: "explicit" },
      ],
      aggregateText: "OpenAI releases GPT-5",
      folderTitle: "OpenAI GPT-5",
    });
    expect(result.retainedFacts).toHaveLength(0);
    expect(result.droppedFacts).toHaveLength(1);
  });

  it("H — attach_enrich immaterial → skip", () => {
    const result = evaluateEligibility(
      baseInput({
        triggerIssue: "attach_enrich",
        triggerEnrichmentType: "confirmation",
        enrichmentFacts: [{ key: "same", value: "v" }],
        previousEnrichmentFactKeys: ["same"],
        lastAcceptedAnalysis: {
          attemptId: "att-1",
          aggregateFingerprint: "a".repeat(64),
          bestSourceTier: "B",
          publicationDecision: "publish",
          analyzedAt: "2026-07-01T00:00:00.000Z",
          validationStatus: "accepted",
        },
      }),
      "B",
    );
    expect(result).toEqual({
      eligible: false,
      reason: "enrichment_immaterial",
    });
  });

  it("I — Ollama down → ollama_unavailable", async () => {
    const client = createOllamaAnalysisClient({
      config: { baseUrl: "http://ollama.test", model: "ministral-3-3b" },
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
      sleep: async () => undefined,
    });
    const result = await client.infer({ prompt: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("ollama_unavailable");
  });

  it("J — publish / enrich_thread_only exigent analyse acceptée (décision)", () => {
    expect(
      decidePublication({
        validationStatus: "rejected",
        composite: 90,
        publishWorthiness: "high",
        hasMainPublication: false,
        isMaterialEnrichReanalysis: false,
        anchoredFactCount: 0,
        priorHoldCount: 0,
      }).decision,
    ).toBe("hold");
  });

  it("K — déjà publié + enrich matériel + fait ancré → enrich_thread_only", () => {
    expect(
      decidePublication({
        validationStatus: "accepted",
        composite: 40,
        publishWorthiness: "medium",
        hasMainPublication: true,
        isMaterialEnrichReanalysis: true,
        anchoredFactCount: 1,
        priorHoldCount: 0,
      }).decision,
    ).toBe("enrich_thread_only");
  });

  it("L — même empreinte après succès → 0 réinférence", async () => {
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
    const second = await service.analyze(baseInput());
    expect(second.kind).toBe("reused");
    expect(infer).toHaveBeenCalledTimes(1);
  });

  it("M — composite 40 + accepté + non publié → reject_editorial", () => {
    expect(
      decidePublication({
        validationStatus: "accepted",
        composite: 40,
        publishWorthiness: "medium",
        hasMainPublication: false,
        isMaterialEnrichReanalysis: false,
        anchoredFactCount: 0,
        priorHoldCount: 0,
      }).decision,
    ).toBe("reject_editorial");
  });

  it("N — composite 60 + accepté + non publié → hold", () => {
    expect(
      decidePublication({
        validationStatus: "accepted",
        composite: 60,
        publishWorthiness: "medium",
        hasMainPublication: false,
        isMaterialEnrichReanalysis: false,
        anchoredFactCount: 0,
        priorHoldCount: 0,
      }).decision,
    ).toBe("hold");
  });

  it("O — 2 hold puis composite 60 → reject_editorial", () => {
    expect(
      decidePublication({
        validationStatus: "accepted",
        composite: 60,
        publishWorthiness: "medium",
        hasMainPublication: false,
        isMaterialEnrichReanalysis: false,
        anchoredFactCount: 0,
        priorHoldCount: 2,
      }).decision,
    ).toBe("reject_editorial");
  });
});
