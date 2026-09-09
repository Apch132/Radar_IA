import { describe, expect, it, vi } from "vitest";

import { createMatchingPersistenceService } from "./matching-persistence-service.js";
import { MatchingPersistenceError } from "./matching-persistence-types.js";
import { createNewsFolderRepository } from "./news-folder-repository.js";

function createTransactionalPrismaDouble() {
  const folders: Array<Record<string, unknown>> = [];
  const memberships: Array<Record<string, unknown>> = [];
  const decisions: Array<Record<string, unknown>> = [];
  let seq = 0;
  let clock = 0;

  function nextTimestamp(): Date {
    clock += 1;
    return new Date(`2026-07-16T14:${String(clock).padStart(2, "0")}:00.000Z`);
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

describe("createMatchingPersistenceService", () => {
  it("persists create_dossier in one transaction (folder + primary + decision)", async () => {
    const { prisma, folders, memberships, decisions } =
      createTransactionalPrismaDouble();
    const service = createMatchingPersistenceService(prisma as never);

    const result = await service.persistDecision({
      issue: "create_dossier",
      articleId: "art_primary",
      folderTitle: "OpenAI announces GPT-5",
      confidence: "none",
      motiveCodes: ["no_candidate"],
      unfavorableSignals: ["no_match"],
    });

    expect(result.folder).not.toBeNull();
    expect(result.folder!.title).toBe("OpenAI announces GPT-5");
    expect(result.folder!.status).toBe("open");
    expect(result.membership).not.toBeNull();
    expect(result.membership!.role).toBe("primary");
    expect(result.membership!.articleId).toBe("art_primary");
    expect(result.decision.issue).toBe("create_dossier");
    expect(result.decision.folderId).toBe(result.folder!.id);
    expect(result.decision.articleId).toBe("art_primary");
    expect(folders).toHaveLength(1);
    expect(memberships).toHaveLength(1);
    expect(decisions).toHaveLength(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it("persists attach_enrich with membership, activity and idle→open", async () => {
    const { prisma, memberships, decisions } = createTransactionalPrismaDouble();
    const repo = createNewsFolderRepository(prisma as never);
    const service = createMatchingPersistenceService(prisma as never);

    const idleFolder = await repo.createFolder({
      title: "Existing event",
      status: "idle",
      lastActivityAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    const previousActivity = idleFolder.lastActivityAt;

    const result = await service.persistDecision({
      issue: "attach_enrich",
      articleId: "art_enrich",
      folderId: idleFolder.id,
      confidence: "high",
      motiveCodes: ["same_entities", "new_fact"],
      favorableSignals: ["shared_url"],
      enrichmentType: "correction",
      enrichmentFacts: { facts: ["availability: GA"] },
    });

    expect(result.membership).not.toBeNull();
    expect(result.membership!.role).toBe("enrichment");
    expect(result.membership!.enrichmentType).toBe("correction");
    expect(result.folder!.status).toBe("open");
    expect(result.folder!.lastActivityAt.getTime()).toBeGreaterThan(
      previousActivity.getTime(),
    );
    expect(result.decision.issue).toBe("attach_enrich");
    expect(result.decision.enrichmentFacts).toEqual({
      facts: ["availability: GA"],
    });
    expect(memberships).toHaveLength(1);
    expect(decisions).toHaveLength(1);
  });

  it("persists duplicate_editorial without extra membership", async () => {
    const { prisma, memberships, decisions, folders } =
      createTransactionalPrismaDouble();
    const repo = createNewsFolderRepository(prisma as never);
    const service = createMatchingPersistenceService(prisma as never);

    const folder = await repo.createFolder({ title: "Covered event" });
    await repo.attachArticle({
      folderId: folder.id,
      articleId: "art_primary",
      role: "primary",
    });
    const beforeActivity = folder.lastActivityAt;
    const beforeStatus = folder.status;

    const result = await service.persistDecision({
      issue: "duplicate_editorial",
      articleId: "art_dup",
      folderId: folder.id,
      confidence: "high",
      motiveCodes: ["no_new_value"],
    });

    expect(result.membership).toBeNull();
    expect(result.folder!.id).toBe(folder.id);
    expect(result.folder!.status).toBe(beforeStatus);
    expect(result.folder!.lastActivityAt).toEqual(beforeActivity);
    expect(result.decision.issue).toBe("duplicate_editorial");
    expect(result.decision.folderId).toBe(folder.id);
    expect(memberships).toHaveLength(1);
    expect(decisions).toHaveLength(1);
    expect(folders).toHaveLength(1);
  });

  it("persists ambiguous_no_action without creating a folder", async () => {
    const { prisma, folders, memberships, decisions } =
      createTransactionalPrismaDouble();
    const service = createMatchingPersistenceService(prisma as never);

    const result = await service.persistDecision({
      issue: "ambiguous_no_action",
      articleId: "art_ambig",
      confidence: "low",
      motiveCodes: ["conflicting_entities"],
      unfavorableSignals: ["entity_mismatch"],
      reevaluable: true,
    });

    expect(result.folder).toBeNull();
    expect(result.membership).toBeNull();
    expect(result.decision.issue).toBe("ambiguous_no_action");
    expect(result.decision.folderId).toBeNull();
    expect(result.decision.reevaluable).toBe(true);
    expect(folders).toHaveLength(0);
    expect(memberships).toHaveLength(0);
    expect(decisions).toHaveLength(1);
  });

  it("rolls back the whole transaction when a step fails", async () => {
    const { prisma, folders, memberships, decisions } =
      createTransactionalPrismaDouble();
    const service = createMatchingPersistenceService(prisma as never);

    await service.persistDecision({
      issue: "create_dossier",
      articleId: "art_shared",
      folderTitle: "First event",
      confidence: "none",
      motiveCodes: ["no_candidate"],
    });

    expect(folders).toHaveLength(1);
    expect(memberships).toHaveLength(1);
    expect(decisions).toHaveLength(1);

    await expect(
      service.persistDecision({
        issue: "create_dossier",
        articleId: "art_shared",
        folderTitle: "Second event should roll back",
        confidence: "none",
        motiveCodes: ["no_candidate"],
      }),
    ).rejects.toThrow(/Unique constraint/);

    expect(folders).toHaveLength(1);
    expect(memberships).toHaveLength(1);
    expect(decisions).toHaveLength(1);
    expect(folders[0]!.title).toBe("First event");
  });

  it("keeps historized decisions coherent across successive issues", async () => {
    const { prisma, decisions } = createTransactionalPrismaDouble();
    const service = createMatchingPersistenceService(prisma as never);

    const created = await service.persistDecision({
      issue: "create_dossier",
      articleId: "art_1",
      folderTitle: "History event",
      confidence: "none",
      motiveCodes: ["no_candidate"],
    });

    const enriched = await service.persistDecision({
      issue: "attach_enrich",
      articleId: "art_2",
      folderId: created.folder!.id,
      confidence: "high",
      motiveCodes: ["new_fact"],
      enrichmentType: "confirmation",
      enrichmentFacts: { facts: ["price: $20"] },
    });

    const duplicate = await service.persistDecision({
      issue: "duplicate_editorial",
      articleId: "art_3",
      folderId: created.folder!.id,
      confidence: "medium",
      motiveCodes: ["no_new_value"],
    });

    const ambiguous = await service.persistDecision({
      issue: "ambiguous_no_action",
      articleId: "art_4",
      confidence: "low",
      motiveCodes: ["low_confidence"],
    });

    expect(decisions).toHaveLength(4);
    expect(decisions.map((row) => row.issue)).toEqual([
      "create_dossier",
      "attach_enrich",
      "duplicate_editorial",
      "ambiguous_no_action",
    ]);
    expect(decisions[0]!.id).toBe(created.decision.id);
    expect(decisions[0]!.issue).toBe("create_dossier");
    expect(decisions[1]!.id).toBe(enriched.decision.id);
    expect(decisions[2]!.id).toBe(duplicate.decision.id);
    expect(decisions[3]!.id).toBe(ambiguous.decision.id);
    expect(decisions[1]!.enrichmentFacts).toEqual({ facts: ["price: $20"] });
  });

  it("refuses attach_enrich on a closed folder", async () => {
    const { prisma, memberships, decisions } = createTransactionalPrismaDouble();
    const repo = createNewsFolderRepository(prisma as never);
    const service = createMatchingPersistenceService(prisma as never);

    const closed = await repo.createFolder({
      title: "Closed event",
      status: "closed",
      closedAt: new Date("2026-07-10T00:00:00.000Z"),
    });

    await expect(
      service.persistDecision({
        issue: "attach_enrich",
        articleId: "art_late",
        folderId: closed.id,
        confidence: "high",
        motiveCodes: ["same_entities"],
      }),
    ).rejects.toBeInstanceOf(MatchingPersistenceError);

    expect(memberships).toHaveLength(0);
    expect(decisions).toHaveLength(0);
  });
});
