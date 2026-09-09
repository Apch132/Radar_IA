import { describe, expect, it, vi } from "vitest";
import {
  createAnalysisService,
  type AnalysisService,
  type AnalysisServiceResult,
  type AnalyzeFolderInput,
} from "@radar-ia/analysis";

import { createAnalysisOrchestrator } from "./analysis-orchestrator.js";
import { matchingResultToAnalysisInput } from "./analysis-orchestration-types.js";
import { createNewsFolderRepository } from "./news-folder-repository.js";
import { createNormalizedArticleRepository } from "./normalized-article-repository.js";

const VALID_SUMMARY =
  "OpenAI annonce une nouvelle version de son modèle phare avec des gains mesurables.";

function validProposal() {
  return {
    schemaVersion: "1" as const,
    summary: VALID_SUMMARY,
    classification: {
      primaryCategory: "model_release" as const,
      secondaryCategories: [] as const,
      announcementNature: "launch" as const,
    },
    scoring: {
      relevance: 80,
      impact: 75,
      novelty: 70,
      confidence: 0.8,
    },
    entities: ["OpenAI"],
    proposedFacts: [
      { key: "model", value: "GPT-5", support: "explicit" as const },
    ],
    editorialProposal: {
      publishWorthiness: "medium" as const,
      suggestedChannelRole: "veille_pertinente" as const,
    },
    rationale: "Annonce claire.",
  };
}

function createAnalysisPrismaDouble() {
  const folders: Array<Record<string, unknown>> = [];
  const memberships: Array<Record<string, unknown>> = [];
  const articles: Array<Record<string, unknown>> = [];
  const attempts: Array<Record<string, unknown>> = [];
  const decisions: Array<Record<string, unknown>> = [];
  let seq = 0;
  let clock = 0;
  let transactionDepth = 0;
  let maxTransactionDepthDuringInfer = 0;

  function nextTimestamp(): Date {
    clock += 1;
    return new Date(`2026-07-16T16:${String(clock).padStart(2, "0")}:00.000Z`);
  }

  function nextId(prefix: string): string {
    seq += 1;
    return `${prefix}_${seq}`;
  }

  const prisma = {
    newsFolder: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        return folders.find((row) => row.id === where.id) ?? null;
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const now = nextTimestamp();
        const row = {
          id: nextId("fld"),
          status: "open",
          closedAt: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        folders.push(row);
        return row;
      }),
    },
    newsFolderArticle: {
      findMany: vi.fn(
        async ({
          where,
          orderBy,
        }: {
          where: { folderId: string };
          orderBy?: { attachedAt: "asc" | "desc" };
        }) => {
          const rows = memberships.filter(
            (row) => row.folderId === where.folderId,
          );
          const sorted = [...rows].sort((a, b) => {
            const ta = (a.attachedAt as Date).getTime();
            const tb = (b.attachedAt as Date).getTime();
            return orderBy?.attachedAt === "desc" ? tb - ta : ta - tb;
          });
          return sorted;
        },
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: nextId("nfa"),
          enrichmentType: null,
          enrichmentFacts: null,
          attachedAt: nextTimestamp(),
          ...data,
        };
        memberships.push(row);
        return row;
      }),
      count: vi.fn(async () => memberships.length),
    },
    normalizedArticle: {
      findMany: vi.fn(
        async ({ where }: { where: { id: { in: string[] } } }) => {
          const ids = new Set(where.id.in);
          return articles.filter((row) => ids.has(row.id as string));
        },
      ),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: nextId("art"),
          categories: [],
          createdAt: nextTimestamp(),
          persistedUpdatedAt: nextTimestamp(),
          ...data,
        };
        articles.push(row);
        return row;
      }),
    },
    analysisAttempt: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: nextId("att"),
          createdAt: nextTimestamp(),
          analyzedAt: nextTimestamp(),
          errorCodes: [],
          warnings: [],
          droppedFacts: [],
          proposalOrigin: "llm",
          ...data,
        };
        attempts.push(row);
        return row;
      }),
      count: vi.fn(async () => attempts.length),
    },
    matchingDecision: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: nextId("dec"),
          decidedAt: nextTimestamp(),
          ...data,
        };
        decisions.push(row);
        return row;
      }),
      count: vi.fn(async () => decisions.length),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      transactionDepth += 1;
      try {
        return await fn(prisma);
      } finally {
        transactionDepth -= 1;
      }
    }),
  };

  function seedArticle(input: {
    id?: string;
    sourceTier?: string;
    title?: string;
    url?: string;
    summary?: string;
    content?: string;
  }) {
    const row = {
      id: input.id ?? nextId("art"),
      sourceId: "src",
      sourceTier: input.sourceTier ?? "B",
      externalId: null,
      title: input.title ?? "OpenAI GPT-5 launch",
      url: input.url ?? "https://example.com/gpt-5",
      publishedAt: null,
      updatedAt: null,
      author: null,
      summary: input.summary ?? "OpenAI releases GPT-5.",
      content:
        input.content ?? "OpenAI releases GPT-5 with improved reasoning.",
      categories: [],
      feedFormat: "rss",
      createdAt: nextTimestamp(),
      persistedUpdatedAt: nextTimestamp(),
    };
    articles.push(row);
    return row;
  }

  function seedFolder(input: {
    id?: string;
    title?: string;
    status?: "open" | "idle" | "closed";
  }) {
    const now = nextTimestamp();
    const row = {
      id: input.id ?? nextId("fld"),
      title: input.title ?? "OpenAI GPT-5 launch",
      status: input.status ?? "open",
      lastActivityAt: now,
      closedAt: input.status === "closed" ? now : null,
      createdAt: now,
      updatedAt: now,
    };
    folders.push(row);
    return row;
  }

  function seedMembership(input: {
    folderId: string;
    articleId: string;
    role: "primary" | "enrichment";
    enrichmentType?: string | null;
    enrichmentFacts?: unknown;
  }) {
    const row = {
      id: nextId("nfa"),
      folderId: input.folderId,
      articleId: input.articleId,
      role: input.role,
      enrichmentType: input.enrichmentType ?? null,
      enrichmentFacts: input.enrichmentFacts ?? null,
      attachedAt: nextTimestamp(),
    };
    memberships.push(row);
    return row;
  }

  function noteInferTransactionDepth(): void {
    maxTransactionDepthDuringInfer = Math.max(
      maxTransactionDepthDuringInfer,
      transactionDepth,
    );
  }

  return {
    prisma,
    folders,
    memberships,
    articles,
    attempts,
    decisions,
    seedArticle,
    seedFolder,
    seedMembership,
    noteInferTransactionDepth,
    getMaxTransactionDepthDuringInfer: () => maxTransactionDepthDuringInfer,
    getTransactionDepth: () => transactionDepth,
  };
}

function createMemoryPersistence() {
  const attempts: Array<{
    id: string;
    folderId: string;
    aggregateFingerprint: string;
    attemptNumber: number;
    analyzedAt: Date;
    modelId: string | null;
    proposalOrigin: "llm";
    validationStatus: "accepted" | "accepted_with_warnings" | "rejected";
    proposal: ReturnType<typeof validProposal> | null;
    backendScoring: {
      effectiveRelevance: number;
      effectiveImpact: number;
      composite: number;
      bestSourceTier: "S" | "A" | "B" | "C" | "D" | "E";
      tierMultiplier: number;
    } | null;
    errorCodes: string[];
    warnings: string[];
    droppedFacts: unknown[];
    publicationDecision: string | null;
    createdAt: Date;
  }> = [];
  let seq = 0;

  return {
    attempts,
    async recordAnalysisAttempt(input: {
      folderId: string;
      aggregateFingerprint: string;
      attemptNumber: number;
      analyzedAt?: Date;
      modelId?: string | null;
      validationStatus: "accepted" | "accepted_with_warnings" | "rejected";
      proposal?: ReturnType<typeof validProposal> | null;
      backendScoring?: {
        effectiveRelevance: number;
        effectiveImpact: number;
        composite: number;
        bestSourceTier: "S" | "A" | "B" | "C" | "D" | "E";
        tierMultiplier: number;
      } | null;
      errorCodes?: readonly string[];
      warnings?: readonly string[];
      droppedFacts?: readonly unknown[];
      publicationDecision?: string | null;
    }) {
      seq += 1;
      const row = {
        id: `att-${seq}`,
        folderId: input.folderId,
        aggregateFingerprint: input.aggregateFingerprint,
        attemptNumber: input.attemptNumber,
        analyzedAt: input.analyzedAt ?? new Date("2026-07-16T16:00:00.000Z"),
        modelId: input.modelId ?? null,
        proposalOrigin: "llm" as const,
        validationStatus: input.validationStatus,
        proposal: input.proposal ?? null,
        backendScoring: input.backendScoring ?? null,
        errorCodes: input.errorCodes ? [...input.errorCodes] : [],
        warnings: input.warnings ? [...input.warnings] : [],
        droppedFacts: input.droppedFacts ? [...input.droppedFacts] : [],
        publicationDecision: input.publicationDecision ?? null,
        createdAt: new Date("2026-07-16T16:00:00.000Z"),
      };
      attempts.push(row);
      return row;
    },
    async getLatestAcceptedAnalysisForFingerprint(
      folderId: string,
      fingerprint: string,
    ) {
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
    async countAttemptsForFingerprint(folderId: string, fingerprint: string) {
      return attempts.filter(
        (a) =>
          a.folderId === folderId && a.aggregateFingerprint === fingerprint,
      ).length;
    },
    async countHoldDecisionsForFingerprint(
      folderId: string,
      fingerprint: string,
    ) {
      return attempts.filter(
        (a) =>
          a.folderId === folderId &&
          a.aggregateFingerprint === fingerprint &&
          a.publicationDecision === "hold",
      ).length;
    },
  };
}

describe("createAnalysisOrchestrator", () => {
  it("1. create_dossier → analysis triggered", async () => {
    const db = createAnalysisPrismaDouble();
    const folder = db.seedFolder({ id: "fld_1" });
    const primary = db.seedArticle({ id: "art_1", sourceTier: "S" });
    db.seedMembership({
      folderId: folder.id as string,
      articleId: primary.id as string,
      role: "primary",
    });

    const analyze = vi.fn(async (): Promise<AnalysisServiceResult> => ({
      kind: "created",
      attemptId: "att-1",
      folderId: "fld_1",
      aggregateFingerprint: "a".repeat(64),
      decision: "publish",
      analysis: {
        schemaVersion: "1",
        folderId: "fld_1",
        analyzedAt: "2026-07-16T16:00:00.000Z",
        modelId: "ministral-3-3b",
        proposalOrigin: "llm",
        aggregateFingerprint: "a".repeat(64),
        proposal: validProposal(),
        validation: { status: "accepted", warnings: [], droppedFacts: [] },
        backendScoring: {
          effectiveRelevance: 88,
          effectiveImpact: 82,
          composite: 80,
          bestSourceTier: "S",
          tierMultiplier: 1.1,
        },
      },
      channelHint: "veille_pertinente",
      attemptNumber: 1,
    }));

    const orchestrator = createAnalysisOrchestrator(db.prisma as never, {
      analysisService: { analyze } satisfies AnalysisService,
    });

    const result = await orchestrator.process({
      matchingIssue: "create_dossier",
      folderId: "fld_1",
      articleId: "art_1",
    });

    expect(analyze).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("analyzed");
    expect(result.matchingIssue).toBe("create_dossier");
    expect(result.attemptId).toBe("att-1");
    expect(result.publicationDecision).toBe("publish");
  });

  it("2. attach_enrich material → analysis", async () => {
    const db = createAnalysisPrismaDouble();
    const folder = db.seedFolder({ id: "fld_2" });
    const primary = db.seedArticle({ id: "art_p", sourceTier: "B" });
    const enrich = db.seedArticle({ id: "art_e", sourceTier: "A" });
    db.seedMembership({
      folderId: folder.id as string,
      articleId: primary.id as string,
      role: "primary",
    });
    db.seedMembership({
      folderId: folder.id as string,
      articleId: enrich.id as string,
      role: "enrichment",
      enrichmentType: "availability",
      enrichmentFacts: {
        facts: [{ key: "availability", value: "GA" }],
      },
    });

    const analyze = vi.fn(async (input: AnalyzeFolderInput) => {
      expect(input.triggerIssue).toBe("attach_enrich");
      expect(input.triggerEnrichmentType).toBe("availability");
      return {
        kind: "created" as const,
        attemptId: "att-2",
        folderId: "fld_2",
        aggregateFingerprint: "b".repeat(64),
        decision: "enrich_thread_only" as const,
        analysis: {
          schemaVersion: "1" as const,
          folderId: "fld_2",
          analyzedAt: "2026-07-16T16:00:00.000Z",
          modelId: "ministral-3-3b",
          proposalOrigin: "llm" as const,
          aggregateFingerprint: "b".repeat(64),
          proposal: validProposal(),
          validation: {
            status: "accepted" as const,
            warnings: [],
            droppedFacts: [],
          },
          backendScoring: {
            effectiveRelevance: 70,
            effectiveImpact: 70,
            composite: 60,
            bestSourceTier: "A" as const,
            tierMultiplier: 1.05,
          },
        },
        channelHint: "none" as const,
        attemptNumber: 1,
      };
    });

    const orchestrator = createAnalysisOrchestrator(db.prisma as never, {
      analysisService: { analyze },
    });

    const result = await orchestrator.process({
      matchingIssue: "attach_enrich",
      folderId: "fld_2",
      articleId: "art_e",
      triggerEnrichmentType: "availability",
      hasMainPublication: true,
    });

    expect(result.status).toBe("analyzed");
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it("3. attach_enrich immaterial → skip via 007.1D", async () => {
    const db = createAnalysisPrismaDouble();
    const folder = db.seedFolder({ id: "fld_3" });
    const primary = db.seedArticle({ id: "art_p3", sourceTier: "B" });
    const enrich = db.seedArticle({ id: "art_e3", sourceTier: "B" });
    db.seedMembership({
      folderId: folder.id as string,
      articleId: primary.id as string,
      role: "primary",
    });
    db.seedMembership({
      folderId: folder.id as string,
      articleId: enrich.id as string,
      role: "enrichment",
      enrichmentType: "confirmation",
      enrichmentFacts: {
        facts: [{ key: "same", value: "1" }],
      },
    });

    const persistence = createMemoryPersistence();
    const infer = vi.fn();
    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence: persistence as never,
      expectedModelId: "ministral-3-3b",
    });

    // Prior enrichment with the same key (excluded trigger → previous keys contain "same").
    const older = db.seedArticle({ id: "art_old", sourceTier: "B" });
    db.seedMembership({
      folderId: folder.id as string,
      articleId: older.id as string,
      role: "enrichment",
      enrichmentType: "confirmation",
      enrichmentFacts: { facts: [{ key: "same", value: "1" }] },
    });

    const orchestrator = createAnalysisOrchestrator(db.prisma as never, {
      analysisService: service,
      analysisAttemptRepository: {
        getLatestAcceptedAnalysis: async () => ({
          id: "prev",
          folderId: "fld_3",
          aggregateFingerprint: "c".repeat(64),
          attemptNumber: 1,
          analyzedAt: new Date("2026-07-16T10:00:00.000Z"),
          modelId: "ministral-3-3b",
          proposalOrigin: "llm" as const,
          validationStatus: "accepted" as const,
          proposal: validProposal(),
          backendScoring: {
            effectiveRelevance: 70,
            effectiveImpact: 70,
            composite: 70,
            bestSourceTier: "B" as const,
            tierMultiplier: 1,
          },
          errorCodes: [],
          warnings: [],
          droppedFacts: [],
          publicationDecision: "publish",
          createdAt: new Date("2026-07-16T10:00:00.000Z"),
        }),
        recordAnalysisAttempt: persistence.recordAnalysisAttempt as never,
        getLatestAcceptedAnalysisForFingerprint:
          persistence.getLatestAcceptedAnalysisForFingerprint as never,
        countAttemptsForFingerprint:
          persistence.countAttemptsForFingerprint as never,
        countHoldDecisionsForFingerprint:
          persistence.countHoldDecisionsForFingerprint as never,
        getAnalysisAttemptById: async () => null,
        listAnalysisAttemptsForFolder: async () => [],
        getLatestAnalysisAttempt: async () => null,
      },
    });

    const result = await orchestrator.process({
      matchingIssue: "attach_enrich",
      folderId: "fld_3",
      articleId: "art_e3",
      triggerEnrichmentType: "confirmation",
    });

    expect(infer).not.toHaveBeenCalled();
    expect(result.status).toBe("skipped");
    expect(result.skipCode).toBe("enrichment_immaterial");
  });

  it("4. duplicate_editorial → zero Ollama, no service call", async () => {
    const analyze = vi.fn();
    const orchestrator = createAnalysisOrchestrator({} as never, {
      analysisService: { analyze },
    });

    const result = await orchestrator.process({
      matchingIssue: "duplicate_editorial",
      folderId: "fld_x",
    });

    expect(analyze).not.toHaveBeenCalled();
    expect(result.status).toBe("skipped");
    expect(result.skipCode).toBe("not_eligible");
    expect(result.serviceResult).toBeNull();
  });

  it("5. ambiguous_no_action → zero Ollama", async () => {
    const analyze = vi.fn();
    const orchestrator = createAnalysisOrchestrator({} as never, {
      analysisService: { analyze },
    });

    const result = await orchestrator.process({
      matchingIssue: "ambiguous_no_action",
    });

    expect(analyze).not.toHaveBeenCalled();
    expect(result.status).toBe("skipped");
    expect(result.skipCode).toBe("not_eligible");
    expect(result.folderId).toBeNull();
  });

  it("6. missing folder → controlled failure", async () => {
    const db = createAnalysisPrismaDouble();
    const analyze = vi.fn();
    const orchestrator = createAnalysisOrchestrator(db.prisma as never, {
      analysisService: { analyze },
    });

    const result = await orchestrator.process({
      matchingIssue: "create_dossier",
      folderId: "missing",
    });

    expect(analyze).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
    expect(result.errorCodes).toContain("folder_not_found");
  });

  it("7. closed folder → skip (via 007.1D)", async () => {
    const db = createAnalysisPrismaDouble();
    const folder = db.seedFolder({ id: "fld_closed", status: "closed" });
    const primary = db.seedArticle({ id: "art_c", sourceTier: "B" });
    db.seedMembership({
      folderId: folder.id as string,
      articleId: primary.id as string,
      role: "primary",
    });

    const persistence = createMemoryPersistence();
    const infer = vi.fn();
    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence: persistence as never,
      expectedModelId: "ministral-3-3b",
    });

    const orchestrator = createAnalysisOrchestrator(db.prisma as never, {
      analysisService: service,
    });

    const result = await orchestrator.process({
      matchingIssue: "create_dossier",
      folderId: "fld_closed",
    });

    expect(infer).not.toHaveBeenCalled();
    expect(result.status).toBe("skipped");
    expect(result.skipCode).toBe("not_eligible");
  });

  it("8–12. aggregate, primary, enrichments order, best tier, facts 006", async () => {
    const db = createAnalysisPrismaDouble();
    const folder = db.seedFolder({ id: "fld_agg" });
    const primary = db.seedArticle({
      id: "art_primary",
      sourceTier: "C",
      title: "Primary title",
    });
    const e1 = db.seedArticle({ id: "art_e1", sourceTier: "E" });
    const e2 = db.seedArticle({ id: "art_e2", sourceTier: "S" });
    db.seedMembership({
      folderId: folder.id as string,
      articleId: primary.id as string,
      role: "primary",
    });
    db.seedMembership({
      folderId: folder.id as string,
      articleId: e1.id as string,
      role: "enrichment",
      enrichmentType: "update",
      enrichmentFacts: { facts: [{ key: "version", value: "1.0" }] },
    });
    db.seedMembership({
      folderId: folder.id as string,
      articleId: e2.id as string,
      role: "enrichment",
      enrichmentType: "availability",
      enrichmentFacts: { facts: [{ key: "availability", value: "GA" }] },
    });

    let captured: AnalyzeFolderInput | null = null;
    const analyze = vi.fn(async (input: AnalyzeFolderInput) => {
      captured = input;
      return {
        kind: "created" as const,
        attemptId: "att-agg",
        folderId: input.folderId,
        aggregateFingerprint: "d".repeat(64),
        decision: "publish" as const,
        analysis: {
          schemaVersion: "1" as const,
          folderId: input.folderId,
          analyzedAt: "2026-07-16T16:00:00.000Z",
          modelId: "ministral-3-3b",
          proposalOrigin: "llm" as const,
          aggregateFingerprint: "d".repeat(64),
          proposal: validProposal(),
          validation: {
            status: "accepted" as const,
            warnings: [],
            droppedFacts: [],
          },
          backendScoring: {
            effectiveRelevance: 80,
            effectiveImpact: 80,
            composite: 80,
            bestSourceTier: "S" as const,
            tierMultiplier: 1.1,
          },
        },
        channelHint: "veille_pertinente" as const,
        attemptNumber: 1,
      };
    });

    const orchestrator = createAnalysisOrchestrator(db.prisma as never, {
      analysisService: { analyze },
    });

    await orchestrator.process({
      matchingIssue: "create_dossier",
      folderId: "fld_agg",
      articleId: "art_e2",
    });

    expect(captured).not.toBeNull();
    expect(captured!.articles).toHaveLength(3);
    expect(captured!.articles.find((a) => a.role === "primary")?.articleId).toBe(
      "art_primary",
    );
    const enrichmentOrder = captured!.articles
      .filter((a) => a.role === "enrichment")
      .map((a) => a.articleId);
    expect(enrichmentOrder).toEqual(["art_e1", "art_e2"]);
    expect(captured!.articles.map((a) => a.sourceTier).sort()).toEqual([
      "C",
      "E",
      "S",
    ]);
    expect(captured!.enrichmentFacts).toEqual([
      { key: "version", value: "1.0" },
      { key: "availability", value: "GA" },
    ]);
    expect(captured!.previousEnrichmentFactKeys).toEqual(["version"]);
  });

  it("13. successful analysis → status analyzed", async () => {
    const db = createAnalysisPrismaDouble();
    const folder = db.seedFolder({ id: "fld_ok" });
    const primary = db.seedArticle({ id: "art_ok", sourceTier: "B" });
    db.seedMembership({
      folderId: folder.id as string,
      articleId: primary.id as string,
      role: "primary",
    });

    const persistence = createMemoryPersistence();
    const infer = vi.fn(async () => {
      db.noteInferTransactionDepth();
      return {
        ok: true as const,
        proposal: validProposal(),
        rawText: "{}",
        modelId: "ministral-3-3b",
        attempts: 1,
      };
    });
    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence: persistence as never,
      expectedModelId: "ministral-3-3b",
      clock: { now: () => new Date("2026-07-16T16:00:00.000Z") },
    });

    const orchestrator = createAnalysisOrchestrator(db.prisma as never, {
      analysisService: service,
    });

    const result = await orchestrator.process({
      matchingIssue: "create_dossier",
      folderId: "fld_ok",
    });

    expect(result.status).toBe("analyzed");
    expect(result.publicationDecision).toBe("publish");
    expect(persistence.attempts).toHaveLength(1);
  });

  it("14. idempotent analysis → reused", async () => {
    const db = createAnalysisPrismaDouble();
    const folder = db.seedFolder({ id: "fld_reuse" });
    const primary = db.seedArticle({ id: "art_reuse", sourceTier: "B" });
    db.seedMembership({
      folderId: folder.id as string,
      articleId: primary.id as string,
      role: "primary",
    });

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
      persistence: persistence as never,
      expectedModelId: "ministral-3-3b",
    });

    const orchestrator = createAnalysisOrchestrator(db.prisma as never, {
      analysisService: service,
    });

    const first = await orchestrator.process({
      matchingIssue: "create_dossier",
      folderId: "fld_reuse",
    });
    const second = await orchestrator.process({
      matchingIssue: "create_dossier",
      folderId: "fld_reuse",
    });

    expect(first.status).toBe("analyzed");
    expect(second.status).toBe("reused");
    expect(infer).toHaveBeenCalledTimes(1);
    expect(persistence.attempts).toHaveLength(1);
  });

  it("15. Ollama error → failed typed result", async () => {
    const db = createAnalysisPrismaDouble();
    const folder = db.seedFolder({ id: "fld_fail" });
    const primary = db.seedArticle({ id: "art_fail", sourceTier: "B" });
    db.seedMembership({
      folderId: folder.id as string,
      articleId: primary.id as string,
      role: "primary",
    });

    const persistence = createMemoryPersistence();
    const infer = vi.fn(async () => ({
      ok: false as const,
      errorCode: "ollama_unavailable" as const,
      message: "down",
      attempts: 3,
    }));
    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence: persistence as never,
      expectedModelId: "ministral-3-3b",
    });

    const orchestrator = createAnalysisOrchestrator(db.prisma as never, {
      analysisService: service,
    });

    const result = await orchestrator.process({
      matchingIssue: "create_dossier",
      folderId: "fld_fail",
    });

    expect(result.status).toBe("failed");
    expect(result.publicationDecision).toBe("hold");
    expect(result.errorCodes.length).toBeGreaterThan(0);
  });

  it("16. append-only persistence respected (service records attempts)", async () => {
    const db = createAnalysisPrismaDouble();
    const folder = db.seedFolder({ id: "fld_append" });
    const primary = db.seedArticle({ id: "art_append", sourceTier: "B" });
    db.seedMembership({
      folderId: folder.id as string,
      articleId: primary.id as string,
      role: "primary",
    });

    const persistence = createMemoryPersistence();
    let call = 0;
    const infer = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return {
          ok: false as const,
          errorCode: "invalid_json" as const,
          message: "bad",
          attempts: 3,
        };
      }
      return {
        ok: true as const,
        proposal: validProposal(),
        rawText: "{}",
        modelId: "ministral-3-3b",
        attempts: 1,
      };
    });
    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence: persistence as never,
      expectedModelId: "ministral-3-3b",
    });
    const orchestrator = createAnalysisOrchestrator(db.prisma as never, {
      analysisService: service,
    });

    await orchestrator.process({
      matchingIssue: "create_dossier",
      folderId: "fld_append",
      forceReanalysis: true,
    });
    // Different fingerprint path: force another attempt with forceReanalysis after failure
    await orchestrator.process({
      matchingIssue: "create_dossier",
      folderId: "fld_append",
      forceReanalysis: true,
    });

    expect(persistence.attempts.length).toBeGreaterThanOrEqual(2);
    const numbers = persistence.attempts.map((a) => a.attemptNumber);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it("17. no transaction held during Ollama", async () => {
    const db = createAnalysisPrismaDouble();
    const folder = db.seedFolder({ id: "fld_tx" });
    const primary = db.seedArticle({ id: "art_tx", sourceTier: "B" });
    db.seedMembership({
      folderId: folder.id as string,
      articleId: primary.id as string,
      role: "primary",
    });

    const persistence = createMemoryPersistence();
    const infer = vi.fn(async () => {
      db.noteInferTransactionDepth();
      expect(db.getTransactionDepth()).toBe(0);
      return {
        ok: true as const,
        proposal: validProposal(),
        rawText: "{}",
        modelId: "ministral-3-3b",
        attempts: 1,
      };
    });
    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence: persistence as never,
      expectedModelId: "ministral-3-3b",
    });

    const orchestrator = createAnalysisOrchestrator(db.prisma as never, {
      analysisService: service,
    });

    await orchestrator.process({
      matchingIssue: "create_dossier",
      folderId: "fld_tx",
    });

    expect(db.getMaxTransactionDepthDuringInfer()).toBe(0);
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("18. 007 error does not roll back 006 decision", async () => {
    const db = createAnalysisPrismaDouble();
    const folder = db.seedFolder({ id: "fld_006" });
    const primary = db.seedArticle({ id: "art_006", sourceTier: "B" });
    db.seedMembership({
      folderId: folder.id as string,
      articleId: primary.id as string,
      role: "primary",
    });
    db.decisions.push({
      id: "dec_006",
      issue: "create_dossier",
      articleId: "art_006",
      folderId: "fld_006",
      confidence: "high",
      motiveCodes: [],
      favorableSignals: [],
      unfavorableSignals: [],
      enrichmentFacts: null,
      proposalOrigin: "rule",
      reevaluable: true,
      decidedAt: new Date("2026-07-16T15:00:00.000Z"),
    });

    const persistence = createMemoryPersistence();
    const infer = vi.fn(async () => ({
      ok: false as const,
      errorCode: "ollama_unavailable" as const,
      message: "down",
      attempts: 3,
    }));
    const service = createAnalysisService({
      ollamaClient: { infer },
      persistence: persistence as never,
      expectedModelId: "ministral-3-3b",
    });

    const orchestrator = createAnalysisOrchestrator(db.prisma as never, {
      analysisService: service,
    });

    const result = await orchestrator.process({
      matchingIssue: "create_dossier",
      folderId: "fld_006",
    });

    expect(result.status).toBe("failed");
    expect(db.decisions).toHaveLength(1);
    expect(db.decisions[0]!.issue).toBe("create_dossier");
    expect(db.folders).toHaveLength(1);
  });

  it("19. no Discord / Fastify imports in orchestrator module", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const file = path.join(
      process.cwd(),
      "src",
      "analysis-orchestrator.ts",
    );
    const source = fs.readFileSync(file, "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*discord/i);
    expect(source).not.toMatch(/from\s+["'][^"']*fastify/i);
    expect(source).not.toMatch(/require\(["'][^"']*discord/i);
    expect(source).not.toMatch(/require\(["'][^"']*fastify/i);
  });

  it("20. determinism: same inputs → same mapped service input", async () => {
    const db = createAnalysisPrismaDouble();
    const folder = db.seedFolder({ id: "fld_det" });
    const primary = db.seedArticle({ id: "art_det", sourceTier: "A" });
    db.seedMembership({
      folderId: folder.id as string,
      articleId: primary.id as string,
      role: "primary",
    });

    const captured: AnalyzeFolderInput[] = [];
    const analyze = vi.fn(async (input: AnalyzeFolderInput) => {
      captured.push(structuredClone(input));
      return {
        kind: "skipped" as const,
        attemptId: "att-det",
        folderId: input.folderId,
        aggregateFingerprint: "e".repeat(64),
        reason: "not_eligible" as const,
        attemptNumber: 1,
      };
    });

    const orchestrator = createAnalysisOrchestrator(db.prisma as never, {
      analysisService: { analyze },
    });

    await orchestrator.process({
      matchingIssue: "create_dossier",
      folderId: "fld_det",
    });
    await orchestrator.process({
      matchingIssue: "create_dossier",
      folderId: "fld_det",
    });

    expect(captured).toHaveLength(2);
    expect(captured[0]).toEqual(captured[1]);
  });

  it("engine 006 → orchestrator 007 coherence on four issues", async () => {
    const analyze = vi.fn(async (): Promise<AnalysisServiceResult> => ({
      kind: "created",
      attemptId: "att-x",
      folderId: "fld_x",
      aggregateFingerprint: "f".repeat(64),
      decision: "publish",
      analysis: {
        schemaVersion: "1",
        folderId: "fld_x",
        analyzedAt: "2026-07-16T16:00:00.000Z",
        modelId: "ministral-3-3b",
        proposalOrigin: "llm",
        aggregateFingerprint: "f".repeat(64),
        proposal: validProposal(),
        validation: { status: "accepted", warnings: [], droppedFacts: [] },
        backendScoring: {
          effectiveRelevance: 80,
          effectiveImpact: 80,
          composite: 80,
          bestSourceTier: "B",
          tierMultiplier: 1,
        },
      },
      channelHint: "veille_pertinente",
      attemptNumber: 1,
    }));

    const db = createAnalysisPrismaDouble();
    db.seedFolder({ id: "fld_x" });
    db.seedArticle({ id: "art_x", sourceTier: "B" });
    db.seedMembership({
      folderId: "fld_x",
      articleId: "art_x",
      role: "primary",
    });

    const orchestrator = createAnalysisOrchestrator(db.prisma as never, {
      analysisService: { analyze },
    });

    const create = await orchestrator.process({
      matchingIssue: "create_dossier",
      folderId: "fld_x",
    });
    expect(create.status).toBe("analyzed");

    analyze.mockClear();
    const dup = await orchestrator.process({
      matchingIssue: "duplicate_editorial",
      folderId: "fld_x",
    });
    expect(dup.status).toBe("skipped");
    expect(analyze).not.toHaveBeenCalled();

    const amb = await orchestrator.process({
      matchingIssue: "ambiguous_no_action",
    });
    expect(amb.status).toBe("skipped");
    expect(analyze).not.toHaveBeenCalled();

    analyze.mockClear();
    const attach = await orchestrator.process({
      matchingIssue: "attach_enrich",
      folderId: "fld_x",
      articleId: "art_x",
      triggerEnrichmentType: "update",
    });
    expect(attach.status).toBe("analyzed");
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it("matchingResultToAnalysisInput maps 006 persistence result", () => {
    const input = matchingResultToAnalysisInput({
      proposal: {
        issue: "attach_enrich",
        folderId: "fld_m",
        confidence: "high",
        motiveCodes: [],
        favorableSignals: [],
        unfavorableSignals: [],
        enrichmentFacts: [{ key: "k", value: "v" }],
        enrichmentType: "update",
        folderTitle: null,
        justification: "test",
        proposalOrigin: "rule",
        reevaluable: true,
      },
      persistence: {
        decision: {
          id: "dec_1",
          issue: "attach_enrich",
          articleId: "art_m",
          folderId: "fld_m",
          confidence: "high",
          motiveCodes: [],
          favorableSignals: [],
          unfavorableSignals: [],
          enrichmentFacts: null,
          proposalOrigin: "rule",
          reevaluable: true,
          decidedAt: new Date("2026-07-16T16:00:00.000Z"),
        },
        folder: {
          id: "fld_m",
          title: "T",
          status: "open",
          lastActivityAt: new Date("2026-07-16T16:00:00.000Z"),
          closedAt: null,
          createdAt: new Date("2026-07-16T16:00:00.000Z"),
          updatedAt: new Date("2026-07-16T16:00:00.000Z"),
        },
        membership: null,
      },
    });

    expect(input.matchingIssue).toBe("attach_enrich");
    expect(input.folderId).toBe("fld_m");
    expect(input.articleId).toBe("art_m");
    expect(input.triggerEnrichmentType).toBe("update");
    expect(input.enrichmentFactsHint).toEqual([{ key: "k", value: "v" }]);
  });

  it("getNormalizedArticlesByIds returns ordered rows", async () => {
    const db = createAnalysisPrismaDouble();
    db.seedArticle({ id: "a1", title: "One" });
    db.seedArticle({ id: "a2", title: "Two" });
    const repo = createNormalizedArticleRepository(db.prisma as never);
    const rows = await repo.getNormalizedArticlesByIds(["a2", "a1", "missing"]);
    expect(rows.map((r) => r.id)).toEqual(["a2", "a1"]);
  });

  it("hasMainPublication defaults to false", async () => {
    const db = createAnalysisPrismaDouble();
    db.seedFolder({ id: "fld_pub" });
    db.seedArticle({ id: "art_pub", sourceTier: "B" });
    db.seedMembership({
      folderId: "fld_pub",
      articleId: "art_pub",
      role: "primary",
    });

    let captured: AnalyzeFolderInput | null = null;
    const analyze = vi.fn(async (input: AnalyzeFolderInput) => {
      captured = input;
      return {
        kind: "skipped" as const,
        attemptId: "att-pub",
        folderId: input.folderId,
        aggregateFingerprint: "0".repeat(64),
        reason: "not_eligible" as const,
        attemptNumber: 1,
      };
    });

    const orchestrator = createAnalysisOrchestrator(db.prisma as never, {
      analysisService: { analyze },
    });

    await orchestrator.process({
      matchingIssue: "create_dossier",
      folderId: "fld_pub",
    });

    expect(captured!.hasMainPublication).toBe(false);
  });

  it("folder repository wiring still works with real factories", async () => {
    const db = createAnalysisPrismaDouble();
    const folders = createNewsFolderRepository(db.prisma as never);
    const created = await folders.createFolder({
      title: "X",
      lastActivityAt: new Date("2026-07-16T16:00:00.000Z"),
    });
    expect(created.id).toBeTruthy();
  });
});
