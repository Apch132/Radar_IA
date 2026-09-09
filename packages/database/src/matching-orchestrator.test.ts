import { describe, expect, it, vi } from "vitest";
import {
  createMatchingEngine,
  extractEventFingerprint,
  type MatchingArticleInput,
  type MatchingCandidateFolder,
} from "@radar-ia/shared";

import {
  createMatchingOrchestrator,
  proposalToPersistInput,
} from "./matching-orchestrator.js";
import { MatchingOrchestrationError } from "./matching-orchestration-types.js";
import { createMatchingPersistenceService } from "./matching-persistence-service.js";
import { createNewsFolderRepository } from "./news-folder-repository.js";

function article(
  overrides: Partial<MatchingArticleInput> &
    Pick<MatchingArticleInput, "title" | "url">,
): MatchingArticleInput {
  return {
    sourceId: "source-a",
    sourceTier: "E",
    categories: [],
    ...overrides,
  };
}

function folderFromArticle(
  id: string,
  seed: MatchingArticleInput,
  overrides: Partial<MatchingCandidateFolder> = {},
): MatchingCandidateFolder {
  return {
    id,
    status: "open",
    title: seed.title,
    fingerprint: extractEventFingerprint(seed),
    ...overrides,
  };
}

function createTransactionalPrismaDouble() {
  const folders: Array<Record<string, unknown>> = [];
  const memberships: Array<Record<string, unknown>> = [];
  const decisions: Array<Record<string, unknown>> = [];
  let seq = 0;
  let clock = 0;

  function nextTimestamp(): Date {
    clock += 1;
    return new Date(`2026-07-16T15:${String(clock).padStart(2, "0")}:00.000Z`);
  }

  function nextId(prefix: string): string {
    seq += 1;
    return `${prefix}_${seq}`;
  }

  function snapshot(): {
    folders: Array<Record<string, unknown>>;
    memberships: Array<Record<string, unknown>>;
    decisions: Array<Record<string, unknown>>;
    seq: number;
    clock: number;
  } {
    return {
      folders: folders.map((row) => ({ ...row })),
      memberships: memberships.map((row) => ({ ...row })),
      decisions: decisions.map((row) => ({ ...row })),
      seq,
      clock,
    };
  }

  function restore(state: ReturnType<typeof snapshot>): void {
    folders.splice(0, folders.length, ...state.folders);
    memberships.splice(0, memberships.length, ...state.memberships);
    decisions.splice(0, decisions.length, ...state.decisions);
    seq = state.seq;
    clock = state.clock;
  }

  const newsFolder = {
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
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      return folders.find((row) => row.id === where.id) ?? null;
    }),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = folders.find((entry) => entry.id === where.id);
        if (row === undefined) {
          throw new Error(`NewsFolder ${where.id} not found`);
        }
        Object.assign(row, data, { updatedAt: nextTimestamp() });
        return row;
      },
    ),
  };

  const newsFolderArticle = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const conflict = memberships.find(
        (row) => row.articleId === data.articleId,
      );
      if (conflict !== undefined) {
        throw new Error("Unique constraint violation on articleId");
      }
      const folderExists = folders.some((row) => row.id === data.folderId);
      if (!folderExists) {
        throw new Error("Foreign key constraint violation (folderId)");
      }
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
  };

  const matchingDecision = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (data.folderId !== null && data.folderId !== undefined) {
        const folderExists = folders.some((row) => row.id === data.folderId);
        if (!folderExists) {
          throw new Error("Foreign key constraint violation (folderId)");
        }
      }
      const row = {
        id: nextId("dec"),
        folderId: null,
        motiveCodes: [],
        favorableSignals: [],
        unfavorableSignals: [],
        enrichmentFacts: null,
        proposalOrigin: null,
        reevaluable: true,
        decidedAt: nextTimestamp(),
        ...data,
      };
      decisions.push(row);
      return row;
    }),
  };

  const prisma = {
    newsFolder,
    newsFolderArticle,
    matchingDecision,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const before = snapshot();
      try {
        return await fn(prisma);
      } catch (error) {
        restore(before);
        throw error;
      }
    }),
  };

  return { prisma, folders, memberships, decisions };
}

describe("createMatchingOrchestrator", () => {
  it("runs create_dossier end-to-end (engine → persistence → history)", async () => {
    const { prisma, folders, memberships, decisions } =
      createTransactionalPrismaDouble();
    const orchestrator = createMatchingOrchestrator(prisma as never);

    const gpt5 = article({
      sourceId: "openai-blog",
      sourceTier: "S",
      title: "OpenAI launches GPT-5",
      url: "https://openai.com/blog/gpt-5",
      publishedAt: "2026-07-10T10:00:00.000Z",
      summary: "OpenAI launches GPT-5 with new capabilities.",
    });

    const result = await orchestrator.process({
      articleId: "art_create",
      article: gpt5,
      candidateFolders: [],
    });

    expect(result.proposal.issue).toBe("create_dossier");
    expect(result.proposal.folderId).toBeNull();
    expect(result.proposal.folderTitle).toBe("OpenAI launches GPT-5");
    expect(result.proposal.proposalOrigin).toBe("rule");
    expect(result.proposal.justification).toContain("issue=create_dossier");

    expect(result.persistence.decision.issue).toBe("create_dossier");
    expect(result.persistence.decision.articleId).toBe("art_create");
    expect(result.persistence.decision.folderId).toBe(
      result.persistence.folder!.id,
    );
    expect(result.persistence.decision.proposalOrigin).toBe("rule");
    expect(result.persistence.decision.motiveCodes).toEqual(
      result.proposal.motiveCodes,
    );
    expect(result.persistence.membership!.role).toBe("primary");
    expect(result.persistence.folder!.title).toBe("OpenAI launches GPT-5");
    expect(result.persistence.folder!.status).toBe("open");

    expect(folders).toHaveLength(1);
    expect(memberships).toHaveLength(1);
    expect(decisions).toHaveLength(1);
  });

  it("runs attach_enrich end-to-end with enrichment facts preserved", async () => {
    const { prisma, memberships, decisions } = createTransactionalPrismaDouble();
    const repo = createNewsFolderRepository(prisma as never);
    const orchestrator = createMatchingOrchestrator(prisma as never);

    const primary = article({
      sourceId: "openai-blog",
      sourceTier: "S",
      title: "OpenAI launches GPT-4o model",
      url: "https://openai.com/blog/gpt-4o",
      publishedAt: "2026-07-01T10:00:00.000Z",
      summary: "OpenAI announces the launch of GPT-4o.",
      categories: ["models"],
    });
    const folder = await repo.createFolder({
      title: primary.title,
      status: "idle",
      lastActivityAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    await repo.attachArticle({
      folderId: folder.id,
      articleId: "art_primary",
      role: "primary",
    });

    const press = article({
      sourceId: "tech-press",
      sourceTier: "E",
      title: "OpenAI launches GPT-4o and opens waitlist",
      url: "https://news.example/openai-gpt-4o",
      publishedAt: "2026-07-01T12:00:00.000Z",
      summary: "OpenAI launches GPT-4o and opens a waitlist for access.",
      categories: ["models"],
    });

    const result = await orchestrator.process({
      articleId: "art_enrich",
      article: press,
      candidateFolders: [folderFromArticle(folder.id, primary)],
    });

    expect(result.proposal.issue).toBe("attach_enrich");
    expect(result.proposal.folderId).toBe(folder.id);
    expect(result.proposal.enrichmentFacts?.some((f) => f.key === "availability:waitlist")).toBe(
      true,
    );
    expect(result.proposal.justification).toContain("issue=attach_enrich");

    expect(result.persistence.decision.issue).toBe("attach_enrich");
    expect(result.persistence.decision.folderId).toBe(folder.id);
    expect(result.persistence.decision.enrichmentFacts).toEqual({
      facts: result.proposal.enrichmentFacts!.map((f) => ({
        key: f.key,
        value: f.value,
      })),
    });
    expect(result.persistence.membership!.role).toBe("enrichment");
    expect(result.persistence.folder!.status).toBe("open");
    expect(memberships).toHaveLength(2);
    expect(decisions).toHaveLength(1);
  });

  it("runs duplicate_editorial without creating membership", async () => {
    const { prisma, memberships, decisions, folders } =
      createTransactionalPrismaDouble();
    const repo = createNewsFolderRepository(prisma as never);
    const orchestrator = createMatchingOrchestrator(prisma as never);

    const primary = article({
      sourceId: "openai-blog",
      sourceTier: "S",
      title: "OpenAI launches GPT-4o",
      url: "https://openai.com/blog/gpt-4o",
      publishedAt: "2026-07-01T10:00:00.000Z",
      summary: "OpenAI launches GPT-4o.",
    });
    const folder = await repo.createFolder({ title: primary.title });
    await repo.attachArticle({
      folderId: folder.id,
      articleId: "art_primary",
      role: "primary",
    });

    const reprint = article({
      sourceId: "mirror-feed",
      sourceTier: "E",
      title: "OpenAI launches GPT-4o",
      url: "https://mirror.example/openai-gpt-4o",
      publishedAt: "2026-07-01T11:00:00.000Z",
      summary: "OpenAI launches GPT-4o.",
    });

    const result = await orchestrator.process({
      articleId: "art_dup",
      article: reprint,
      candidateFolders: [folderFromArticle(folder.id, primary)],
    });

    expect(result.proposal.issue).toBe("duplicate_editorial");
    expect(result.proposal.folderId).toBe(folder.id);
    expect(result.proposal.justification).toContain("issue=duplicate_editorial");

    expect(result.persistence.decision.issue).toBe("duplicate_editorial");
    expect(result.persistence.decision.folderId).toBe(folder.id);
    expect(result.persistence.membership).toBeNull();
    expect(result.persistence.folder!.id).toBe(folder.id);
    expect(memberships).toHaveLength(1);
    expect(folders).toHaveLength(1);
    expect(decisions).toHaveLength(1);
  });

  it("runs ambiguous_no_action without creating a folder", async () => {
    const { prisma, folders, memberships, decisions } =
      createTransactionalPrismaDouble();
    const orchestrator = createMatchingOrchestrator(prisma as never);

    const thin = article({
      sourceId: "thin-source",
      sourceTier: "E",
      title: "Update",
      url: "https://example.com/u",
      summary: "x",
    });

    const result = await orchestrator.process({
      articleId: "art_ambig",
      article: thin,
      candidateFolders: [],
    });

    expect(result.proposal.issue).toBe("ambiguous_no_action");
    expect(result.proposal.justification).toContain("issue=ambiguous_no_action");
    expect(result.persistence.decision.issue).toBe("ambiguous_no_action");
    expect(result.persistence.folder).toBeNull();
    expect(result.persistence.membership).toBeNull();
    expect(folders).toHaveLength(0);
    expect(memberships).toHaveLength(0);
    expect(decisions).toHaveLength(1);
    expect(result.persistence.decision.reevaluable).toBe(true);
  });

  it("rolls back persistence when a later transactional step fails", async () => {
    const { prisma, folders, memberships, decisions } =
      createTransactionalPrismaDouble();
    const orchestrator = createMatchingOrchestrator(prisma as never);

    const first = article({
      sourceId: "openai-blog",
      sourceTier: "S",
      title: "OpenAI launches GPT-5",
      url: "https://openai.com/blog/gpt-5",
      publishedAt: "2026-07-10T10:00:00.000Z",
      summary: "OpenAI launches GPT-5.",
    });

    await orchestrator.process({
      articleId: "art_shared",
      article: first,
      candidateFolders: [],
    });

    expect(folders).toHaveLength(1);
    expect(memberships).toHaveLength(1);
    expect(decisions).toHaveLength(1);

    const second = article({
      sourceId: "openai-blog",
      sourceTier: "S",
      title: "Anthropic launches Claude 5",
      url: "https://anthropic.com/claude-5",
      publishedAt: "2026-07-11T10:00:00.000Z",
      summary: "Anthropic launches Claude 5.",
    });

    await expect(
      orchestrator.process({
        articleId: "art_shared",
        article: second,
        candidateFolders: [],
      }),
    ).rejects.toThrow(/Unique constraint/);

    expect(folders).toHaveLength(1);
    expect(memberships).toHaveLength(1);
    expect(decisions).toHaveLength(1);
    expect(folders[0]!.title).toBe("OpenAI launches GPT-5");
  });

  it("keeps engine issue and persistence issue aligned", async () => {
    const { prisma } = createTransactionalPrismaDouble();
    const engine = createMatchingEngine();
    const persistence = createMatchingPersistenceService(prisma as never);
    const evaluateSpy = vi.spyOn(engine, "evaluate");
    const persistSpy = vi.spyOn(persistence, "persistDecision");
    const orchestrator = createMatchingOrchestrator(prisma as never, {
      engine,
      persistence,
    });

    const articleInput = article({
      sourceId: "openai-blog",
      sourceTier: "S",
      title: "OpenAI launches GPT-5",
      url: "https://openai.com/blog/gpt-5",
      publishedAt: "2026-07-10T10:00:00.000Z",
      summary: "OpenAI launches GPT-5.",
    });

    const result = await orchestrator.process({
      articleId: "art_align",
      article: articleInput,
      candidateFolders: [],
    });

    expect(evaluateSpy).toHaveBeenCalledTimes(1);
    expect(persistSpy).toHaveBeenCalledTimes(1);
    expect(persistSpy.mock.calls[0]![0].issue).toBe(result.proposal.issue);
    expect(result.persistence.decision.issue).toBe(result.proposal.issue);
    expect(result.persistence.decision.motiveCodes).toEqual(
      result.proposal.motiveCodes,
    );
    expect(result.persistence.decision.favorableSignals).toEqual(
      result.proposal.favorableSignals,
    );
    expect(result.persistence.decision.unfavorableSignals).toEqual(
      result.proposal.unfavorableSignals,
    );
  });

  it("preserves justification and is globally deterministic", async () => {
    const { prisma: prismaA } = createTransactionalPrismaDouble();
    const { prisma: prismaB } = createTransactionalPrismaDouble();
    const orchestratorA = createMatchingOrchestrator(prismaA as never);
    const orchestratorB = createMatchingOrchestrator(prismaB as never);

    const input = {
      articleId: "art_det",
      article: article({
        sourceId: "openai-blog",
        sourceTier: "S",
        title: "OpenAI launches GPT-5",
        url: "https://openai.com/blog/gpt-5",
        publishedAt: "2026-07-10T10:00:00.000Z",
        summary: "OpenAI launches GPT-5 with new capabilities.",
      }),
      candidateFolders: [] as MatchingCandidateFolder[],
      decidedAt: new Date("2026-07-16T15:00:00.000Z"),
    };

    const first = await orchestratorA.process(input);
    const second = await orchestratorB.process(input);

    expect(first.proposal).toEqual(second.proposal);
    expect(first.proposal.justification).toBe(second.proposal.justification);
    expect(first.proposal.justification.length).toBeGreaterThan(0);
    expect(first.persistence.decision.issue).toBe(
      second.persistence.decision.issue,
    );
    expect(first.persistence.decision.motiveCodes).toEqual(
      second.persistence.decision.motiveCodes,
    );
    expect(first.persistence.folder!.title).toBe(
      second.persistence.folder!.title,
    );
  });

  it("rejects incomplete create_dossier proposals at the mapping boundary", () => {
    expect(() =>
      proposalToPersistInput("art_x", {
        issue: "create_dossier",
        folderId: null,
        confidence: "none",
        motiveCodes: ["no_credible_candidate"],
        favorableSignals: [],
        unfavorableSignals: [],
        enrichmentFacts: null,
        enrichmentType: null,
        folderTitle: null,
        justification: "issue=create_dossier",
        proposalOrigin: "rule",
        reevaluable: true,
      }),
    ).toThrow(MatchingOrchestrationError);
  });
});
