import { describe, expect, it, vi } from "vitest";

import { createOllamaAnalysisClient } from "./ollama-client.js";
import type { FetchLike } from "./ollama-client.js";

const VALID_SUMMARY =
  "OpenAI annonce une nouvelle version de son modèle phare avec des gains mesurables.";

function validProposalJson(): string {
  return JSON.stringify({
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
    proposedFacts: [],
    editorialProposal: {
      publishWorthiness: "medium",
      suggestedChannelRole: "veille_pertinente",
    },
    rationale: "Annonce claire.",
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("createOllamaAnalysisClient", () => {
  it("returns a validated proposal on success", async () => {
    const fetchMock: FetchLike = vi.fn(async () =>
      jsonResponse({
        model: "ministral-3-3b",
        response: validProposalJson(),
      }),
    );

    const client = createOllamaAnalysisClient({
      config: {
        baseUrl: "http://ollama.test",
        model: "ministral-3-3b",
      },
      fetch: fetchMock,
      sleep: async () => undefined,
    });

    const result = await client.infer({ prompt: "Analyse ce dossier." });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.summary).toBe(VALID_SUMMARY);
    expect(result.modelId).toBe("ministral-3-3b");
    expect(result.attempts).toBe(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = vi.mocked(fetchMock).mock.calls[0]!;
    const body = JSON.parse(init!.body as string) as {
      model: string;
      stream: boolean;
      format: string;
      prompt: string;
    };
    expect(body.model).toBe("ministral-3-3b");
    expect(body.stream).toBe(false);
    expect(body.format).toBe("json");
    expect(body.prompt).toContain("Analyse ce dossier.");
  });

  it("prepends defaultSystemPrompt when provided", async () => {
    const fetchMock: FetchLike = vi.fn(async () =>
      jsonResponse({ response: validProposalJson() }),
    );

    const client = createOllamaAnalysisClient({
      config: { baseUrl: "http://ollama.test", model: "m" },
      fetch: fetchMock,
      defaultSystemPrompt: "Tu produis uniquement du JSON.",
      sleep: async () => undefined,
    });

    await client.infer({ prompt: "USER" });
    const [, init] = vi.mocked(fetchMock).mock.calls[0]!;
    const body = JSON.parse(init!.body as string) as { prompt: string };
    expect(body.prompt).toBe("Tu produis uniquement du JSON.\n\nUSER");
  });

  it("maps network failure to ollama_unavailable", async () => {
    const fetchMock: FetchLike = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    const client = createOllamaAnalysisClient({
      config: { baseUrl: "http://ollama.test", model: "m" },
      fetch: fetchMock,
      maxAttempts: 1,
      sleep: async () => undefined,
    });

    const result = await client.infer({ prompt: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("ollama_unavailable");
    expect(result.attempts).toBe(1);
  });

  it("maps AbortError to inference_timeout", async () => {
    const fetchMock: FetchLike = vi.fn(async (_url, init) => {
      const error = new Error("aborted");
      error.name = "AbortError";
      // Simulate timeout abort if signal already aborted by timer in real runs;
      // here we throw AbortError directly.
      void init;
      throw error;
    });

    const client = createOllamaAnalysisClient({
      config: { baseUrl: "http://ollama.test", model: "m" },
      fetch: fetchMock,
      maxAttempts: 1,
      sleep: async () => undefined,
    });

    const result = await client.infer({ prompt: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("inference_timeout");
  });

  it("retries invalid_json then succeeds", async () => {
    const sleeps: number[] = [];
    const fetchMock: FetchLike = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ response: "{broken" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ response: validProposalJson() }),
      );

    const client = createOllamaAnalysisClient({
      config: { baseUrl: "http://ollama.test", model: "m" },
      fetch: fetchMock,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const result = await client.infer({ prompt: "x" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attempts).toBe(2);
    expect(sleeps).toEqual([5_000]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("exhausts retries on schema_violation", async () => {
    const sleeps: number[] = [];
    const bad = JSON.stringify({
      schemaVersion: "1",
      summary: VALID_SUMMARY,
      classification: {
        primaryCategory: "nope",
        secondaryCategories: [],
        announcementNature: "launch",
      },
      scoring: {
        relevance: 1,
        impact: 1,
        novelty: 1,
        confidence: 0.5,
      },
      entities: [],
      proposedFacts: [],
      editorialProposal: {
        publishWorthiness: "none",
        suggestedChannelRole: "none",
      },
      rationale: "",
    });

    const fetchMock: FetchLike = vi.fn(async () =>
      jsonResponse({ response: bad }),
    );

    const client = createOllamaAnalysisClient({
      config: { baseUrl: "http://ollama.test", model: "m" },
      fetch: fetchMock,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const result = await client.infer({ prompt: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("schema_violation");
    expect(result.attempts).toBe(3);
    expect(sleeps).toEqual([5_000, 15_000]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries empty_summary", async () => {
    const short = JSON.stringify({
      schemaVersion: "1",
      summary: "Trop court.",
      classification: {
        primaryCategory: "other",
        secondaryCategories: [],
        announcementNature: "other",
      },
      scoring: {
        relevance: 10,
        impact: 10,
        novelty: 10,
        confidence: 0.1,
      },
      entities: [],
      proposedFacts: [],
      editorialProposal: {
        publishWorthiness: "none",
        suggestedChannelRole: "none",
      },
      rationale: "",
    });

    const fetchMock: FetchLike = vi.fn(async () =>
      jsonResponse({ response: short }),
    );

    const client = createOllamaAnalysisClient({
      config: { baseUrl: "http://ollama.test", model: "m" },
      fetch: fetchMock,
      maxAttempts: 2,
      sleep: async () => undefined,
    });

    const result = await client.infer({ prompt: "x" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("empty_summary");
    expect(result.attempts).toBe(2);
  });

  it("serializes concurrent inferences (concurrency = 1)", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchMock: FetchLike = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 30));
      inFlight -= 1;
      return jsonResponse({ response: validProposalJson() });
    });

    const client = createOllamaAnalysisClient({
      config: { baseUrl: "http://ollama.test", model: "m" },
      fetch: fetchMock,
      sleep: async () => undefined,
    });

    const [a, b] = await Promise.all([
      client.infer({ prompt: "a" }),
      client.infer({ prompt: "b" }),
    ]);

    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(maxInFlight).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns queue_timeout when the slot wait exceeds the limit", async () => {
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const fetchMock: FetchLike = vi.fn(async () => {
      await firstGate;
      return jsonResponse({ response: validProposalJson() });
    });

    const client = createOllamaAnalysisClient({
      config: { baseUrl: "http://ollama.test", model: "m" },
      fetch: fetchMock,
      queueTimeoutMs: 40,
      sleep: async () => undefined,
    });

    const first = client.infer({ prompt: "hold" });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await client.infer({ prompt: "queued" });

    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.errorCode).toBe("queue_timeout");
    }

    releaseFirst();
    const firstResult = await first;
    expect(firstResult.ok).toBe(true);
  });

  it("rejects maxConcurrency other than 1 at construction", () => {
    expect(() =>
      createOllamaAnalysisClient({
        config: {
          baseUrl: "http://ollama.test",
          model: "m",
          maxConcurrency: 2 as 1,
        },
      }),
    ).toThrow(/must be 1/);
  });
});
