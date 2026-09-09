import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createAnalysisAttemptRepository } from "./analysis-attempt-repository.js";
import type {
  AnalysisProposalV1,
  BackendScoringV1,
  RecordAnalysisAttemptInput,
} from "./analysis-types.js";
import { AnalysisIntegrityError } from "./analysis-types.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(packageRoot, "prisma", "migrations");
const schemaPath = join(packageRoot, "prisma", "schema.prisma");

const FP_A =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const FP_B =
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function sampleProposal(
  overrides: Partial<AnalysisProposalV1> = {},
): AnalysisProposalV1 {
  return {
    schemaVersion: "1",
    summary:
      "OpenAI annonce un nouveau modèle multimodal avec disponibilité progressive pour les développeurs.",
    classification: {
      primaryCategory: "model_release",
      secondaryCategories: ["product_update"],
      announcementNature: "launch",
    },
    scoring: {
      relevance: 80,
      impact: 75,
      novelty: 70,
      confidence: 0.85,
    },
    entities: ["OpenAI", "GPT"],
    proposedFacts: [
      { key: "vendor", value: "OpenAI", support: "explicit" },
      { key: "guess", value: "Q3 release", support: "inferred" },
    ],
    editorialProposal: {
      publishWorthiness: "high",
      suggestedChannelRole: "annonces_majeures",
    },
    rationale: "Annonce officielle structurée et vérifiable.",
    ...overrides,
  };
}

function sampleScoring(
  overrides: Partial<BackendScoringV1> = {},
): BackendScoringV1 {
  return {
    effectiveRelevance: 84,
    effectiveImpact: 78,
    composite: 78,
    bestSourceTier: "S",
    tierMultiplier: 1.1,
    ...overrides,
  };
}

function createPrismaDouble(seedFolderIds: string[] = ["fld_1"]) {
  const folders = seedFolderIds.map((id) => ({ id, title: `Folder ${id}` }));
  const attempts: Array<Record<string, unknown>> = [];
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

  const newsFolder = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      return folders.find((row) => row.id === where.id) ?? null;
    }),
  };

  const analysisAttempt = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const folderExists = folders.some((row) => row.id === data.folderId);
      if (!folderExists) {
        throw new Error("Foreign key constraint violation (folderId)");
      }
      const conflict = attempts.find(
        (row) =>
          row.folderId === data.folderId &&
          row.aggregateFingerprint === data.aggregateFingerprint &&
          row.attemptNumber === data.attemptNumber,
      );
      if (conflict !== undefined) {
        throw new Error("Unique constraint violation on attemptNumber");
      }
      const now = nextTimestamp();
      const row = {
        id: nextId("aa"),
        modelId: null,
        proposalOrigin: "llm",
        proposal: null,
        backendScoring: null,
        errorCodes: [],
        warnings: [],
        droppedFacts: [],
        publicationDecision: null,
        analyzedAt: data.analyzedAt ?? now,
        createdAt: now,
        ...data,
      };
      attempts.push(row);
      return row;
    }),
    findUnique: vi.fn(
      async ({
        where,
      }: {
        where:
          | { id: string }
          | {
              folderId_aggregateFingerprint_attemptNumber: {
                folderId: string;
                aggregateFingerprint: string;
                attemptNumber: number;
              };
            };
      }) => {
        if ("id" in where) {
          return attempts.find((row) => row.id === where.id) ?? null;
        }
        const key = where.folderId_aggregateFingerprint_attemptNumber;
        return (
          attempts.find(
            (row) =>
              row.folderId === key.folderId &&
              row.aggregateFingerprint === key.aggregateFingerprint &&
              row.attemptNumber === key.attemptNumber,
          ) ?? null
        );
      },
    ),
    findFirst: vi.fn(
      async ({
        where,
        orderBy,
      }: {
        where: {
          folderId: string;
          aggregateFingerprint?: string;
          validationStatus?: { in: string[] };
          publicationDecision?: string;
        };
        orderBy?: Array<Record<string, "asc" | "desc">>;
      }) => {
        let rows = attempts.filter((row) => row.folderId === where.folderId);
        if (where.aggregateFingerprint !== undefined) {
          rows = rows.filter(
            (row) => row.aggregateFingerprint === where.aggregateFingerprint,
          );
        }
        if (where.validationStatus?.in !== undefined) {
          const allowed = new Set(where.validationStatus.in);
          rows = rows.filter((row) =>
            allowed.has(row.validationStatus as string),
          );
        }
        if (where.publicationDecision !== undefined) {
          rows = rows.filter(
            (row) => row.publicationDecision === where.publicationDecision,
          );
        }
        rows = sortAttempts(rows, orderBy);
        return rows[0] ?? null;
      },
    ),
    findMany: vi.fn(
      async ({
        where,
        orderBy,
      }: {
        where: { folderId: string; aggregateFingerprint?: string };
        orderBy?: Array<Record<string, "asc" | "desc">>;
      }) => {
        let rows = attempts.filter((row) => row.folderId === where.folderId);
        if (where.aggregateFingerprint !== undefined) {
          rows = rows.filter(
            (row) => row.aggregateFingerprint === where.aggregateFingerprint,
          );
        }
        return sortAttempts(rows, orderBy);
      },
    ),
    count: vi.fn(
      async ({
        where,
      }: {
        where: {
          folderId: string;
          aggregateFingerprint?: string;
          publicationDecision?: string;
        };
      }) => {
        return attempts.filter((row) => {
          if (row.folderId !== where.folderId) {
            return false;
          }
          if (
            where.aggregateFingerprint !== undefined &&
            row.aggregateFingerprint !== where.aggregateFingerprint
          ) {
            return false;
          }
          if (
            where.publicationDecision !== undefined &&
            row.publicationDecision !== where.publicationDecision
          ) {
            return false;
          }
          return true;
        }).length;
      },
    ),
    update: vi.fn(async () => {
      throw new Error("AnalysisAttempt must remain append-only");
    }),
    delete: vi.fn(async () => {
      throw new Error("AnalysisAttempt must remain append-only");
    }),
  };

  const prisma = { newsFolder, analysisAttempt };
  return { prisma, attempts, analysisAttempt, folders };
}

function sortAttempts(
  rows: Array<Record<string, unknown>>,
  orderBy?: Array<Record<string, "asc" | "desc">>,
): Array<Record<string, unknown>> {
  const sorted = [...rows];
  if (orderBy === undefined || orderBy.length === 0) {
    return sorted;
  }
  sorted.sort((a, b) => {
    for (const clause of orderBy) {
      const [field, direction] = Object.entries(clause)[0]!;
      const av = a[field];
      const bv = b[field];
      let cmp = 0;
      if (av instanceof Date && bv instanceof Date) {
        cmp = av.getTime() - bv.getTime();
      } else {
        cmp = String(av).localeCompare(String(bv));
      }
      if (cmp !== 0) {
        return direction === "asc" ? cmp : -cmp;
      }
    }
    return 0;
  });
  return sorted;
}

function acceptedInput(
  overrides: Partial<RecordAnalysisAttemptInput> = {},
): RecordAnalysisAttemptInput {
  return {
    folderId: "fld_1",
    aggregateFingerprint: FP_A,
    attemptNumber: 1,
    validationStatus: "accepted",
    modelId: "ministral-3:3b",
    proposal: sampleProposal(),
    backendScoring: sampleScoring(),
    errorCodes: [],
    warnings: [],
    droppedFacts: [],
    publicationDecision: "publish",
    ...overrides,
  };
}

describe("Prisma migration 007.1B", () => {
  it("ships AnalysisAttempt enums, NewsFolder relation, Restrict FK and indexes", () => {
    expect(existsSync(join(migrationsDir, "migration_lock.toml"))).toBe(true);

    const schema = readFileSync(schemaPath, "utf8");
    expect(schema).toContain("model AnalysisAttempt");
    expect(schema).toContain("enum AnalysisValidationStatus");
    expect(schema).toContain("enum PublicationDecision");
    expect(schema).toContain("enum AnalysisErrorCode");
    expect(schema).toContain("enum AnalysisWarningCode");
    expect(schema).toContain("analysisAttempts  AnalysisAttempt[]");
    expect(schema).toContain("onDelete: Restrict");
    expect(schema).toContain(
      "@@unique([folderId, aggregateFingerprint, attemptNumber])",
    );
    expect(schema).toContain("@@index([folderId])");
    expect(schema).toContain("@@index([folderId, aggregateFingerprint])");
    expect(schema).toContain("@@index([folderId, analyzedAt])");

    // AnalysisAttempt itself must not model Discord snowflakes (008 owns that).
    const analysisBlock = schema.slice(
      schema.indexOf("model AnalysisAttempt"),
      schema.indexOf("model FolderPublication") === -1
        ? schema.length
        : schema.indexOf("model FolderPublication"),
    );
    expect(analysisBlock).not.toContain("messageId");
    expect(analysisBlock).not.toContain("threadId");
    expect(schema).not.toContain("model Ollama");

    const entries = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    const migrationName = entries.find((name) =>
      name.includes("analysis_attempt_data_model"),
    );
    expect(migrationName).toBeDefined();

    const sql = readFileSync(
      join(migrationsDir, migrationName!, "migration.sql"),
      "utf8",
    );

    expect(sql).toContain('CREATE TABLE "AnalysisAttempt"');
    expect(sql).toContain('"validationStatus" "AnalysisValidationStatus"');
    expect(sql).toContain('"publicationDecision" "PublicationDecision"');
    expect(sql).toContain('"errorCodes" "AnalysisErrorCode"[]');
    expect(sql).toContain('"warnings" "AnalysisWarningCode"[]');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "AnalysisAttempt_folderId_aggregateFingerprint_attemptNumber_key"',
    );
    expect(sql).toContain("ON DELETE RESTRICT");
    expect(sql).toContain("accepted_with_warnings");
    expect(sql).toContain("enrich_thread_only");
    expect(sql).toContain("facts_dropped");
    expect(sql).not.toContain("messageId");
    expect(sql).not.toContain("threadId");
  });
});

describe("createAnalysisAttemptRepository", () => {
  it("creates a complete accepted analysis with publication decision", async () => {
    const { prisma, attempts } = createPrismaDouble();
    const repo = createAnalysisAttemptRepository(prisma as never);
    const proposal = sampleProposal();

    const row = await repo.recordAnalysisAttempt(
      acceptedInput({ proposal, publicationDecision: "publish" }),
    );

    expect(row.validationStatus).toBe("accepted");
    expect(row.proposal).toEqual(proposal);
    expect(row.backendScoring?.composite).toBe(78);
    expect(row.publicationDecision).toBe("publish");
    expect(row.proposalOrigin).toBe("llm");
    expect(attempts).toHaveLength(1);
  });

  it("creates accepted_with_warnings with dropped facts and warning codes", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createAnalysisAttemptRepository(prisma as never);
    const dropped = [
      { key: "guess", value: "Q3 release", support: "inferred" as const },
    ];

    const row = await repo.recordAnalysisAttempt(
      acceptedInput({
        validationStatus: "accepted_with_warnings",
        warnings: ["facts_dropped", "entities_deduplicated"],
        droppedFacts: dropped,
        publicationDecision: "hold",
      }),
    );

    expect(row.validationStatus).toBe("accepted_with_warnings");
    expect(row.warnings).toEqual(["facts_dropped", "entities_deduplicated"]);
    expect(row.droppedFacts).toEqual(dropped);
    expect(row.backendScoring).not.toBeNull();
  });

  it("creates a rejected pre-parse trace without proposal", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createAnalysisAttemptRepository(prisma as never);

    const row = await repo.recordAnalysisAttempt({
      folderId: "fld_1",
      aggregateFingerprint: FP_A,
      attemptNumber: 1,
      validationStatus: "rejected",
      modelId: "ministral-3:3b",
      proposal: null,
      backendScoring: null,
      errorCodes: ["invalid_json"],
      warnings: [],
      droppedFacts: [],
      publicationDecision: "hold",
    });

    expect(row.proposal).toBeNull();
    expect(row.backendScoring).toBeNull();
    expect(row.errorCodes).toEqual(["invalid_json"]);
    expect(row.validationStatus).toBe("rejected");
  });

  it("creates a rejected trace with parseable but invalid proposal", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createAnalysisAttemptRepository(prisma as never);
    const proposal = sampleProposal({
      summary: "trop court",
    });

    const row = await repo.recordAnalysisAttempt({
      folderId: "fld_1",
      aggregateFingerprint: FP_A,
      attemptNumber: 1,
      validationStatus: "rejected",
      modelId: "ministral-3:3b",
      proposal,
      backendScoring: null,
      errorCodes: ["empty_summary"],
      warnings: [],
      droppedFacts: [],
      publicationDecision: "hold",
    });

    expect(row.proposal).toEqual(proposal);
    expect(row.backendScoring).toBeNull();
    expect(row.errorCodes).toEqual(["empty_summary"]);
  });

  it("keeps append-only history across three attempts", async () => {
    const { prisma, attempts, analysisAttempt } = createPrismaDouble();
    const repo = createAnalysisAttemptRepository(prisma as never);

    const first = await repo.recordAnalysisAttempt(
      acceptedInput({
        attemptNumber: 1,
        validationStatus: "rejected",
        proposal: null,
        backendScoring: null,
        errorCodes: ["ollama_unavailable"],
        publicationDecision: "hold",
      }),
    );
    const second = await repo.recordAnalysisAttempt(
      acceptedInput({
        attemptNumber: 2,
        validationStatus: "rejected",
        proposal: sampleProposal(),
        backendScoring: null,
        errorCodes: ["schema_violation"],
        publicationDecision: "hold",
      }),
    );
    const third = await repo.recordAnalysisAttempt(
      acceptedInput({
        attemptNumber: 3,
        publicationDecision: "publish",
      }),
    );

    expect(attempts).toHaveLength(3);
    expect(first.id).not.toBe(second.id);
    expect(second.id).not.toBe(third.id);
    expect(attempts[0]!.errorCodes).toEqual(["ollama_unavailable"]);
    expect(analysisAttempt.update).not.toHaveBeenCalled();
    expect(analysisAttempt.delete).not.toHaveBeenCalled();
  });

  it("reads the latest attempt and latest accepted analysis", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createAnalysisAttemptRepository(prisma as never);

    await repo.recordAnalysisAttempt(
      acceptedInput({
        attemptNumber: 1,
        validationStatus: "rejected",
        proposal: null,
        backendScoring: null,
        errorCodes: ["queue_timeout"],
        publicationDecision: "hold",
      }),
    );
    const accepted = await repo.recordAnalysisAttempt(
      acceptedInput({
        attemptNumber: 2,
        publicationDecision: "publish",
      }),
    );
    await repo.recordAnalysisAttempt({
      folderId: "fld_1",
      aggregateFingerprint: FP_A,
      attemptNumber: 3,
      validationStatus: "rejected",
      proposal: null,
      backendScoring: null,
      errorCodes: ["not_eligible"],
      publicationDecision: null,
    });

    const latest = await repo.getLatestAnalysisAttempt("fld_1");
    const latestAccepted = await repo.getLatestAcceptedAnalysis("fld_1");

    expect(latest?.attemptNumber).toBe(3);
    expect(latest?.validationStatus).toBe("rejected");
    expect(latestAccepted?.id).toBe(accepted.id);
    expect(latestAccepted?.validationStatus).toBe("accepted");
  });

  it("reads latest accepted analysis for a fingerprint and counts attempts/holds", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createAnalysisAttemptRepository(prisma as never);

    await repo.recordAnalysisAttempt(
      acceptedInput({
        aggregateFingerprint: FP_A,
        attemptNumber: 1,
        publicationDecision: "hold",
      }),
    );
    await repo.recordAnalysisAttempt(
      acceptedInput({
        aggregateFingerprint: FP_A,
        attemptNumber: 2,
        validationStatus: "accepted_with_warnings",
        warnings: ["facts_dropped"],
        droppedFacts: [
          { key: "x", value: "y", support: "inferred" },
        ],
        publicationDecision: "hold",
      }),
    );
    await repo.recordAnalysisAttempt(
      acceptedInput({
        aggregateFingerprint: FP_B,
        attemptNumber: 1,
        publicationDecision: "publish",
      }),
    );

    const forFp = await repo.getLatestAcceptedAnalysisForFingerprint(
      "fld_1",
      FP_A,
    );
    expect(forFp?.attemptNumber).toBe(2);
    expect(forFp?.aggregateFingerprint).toBe(FP_A);

    expect(await repo.countAttemptsForFingerprint("fld_1", FP_A)).toBe(2);
    expect(await repo.countHoldDecisionsForFingerprint("fld_1", FP_A)).toBe(2);
    expect(await repo.countAttemptsForFingerprint("fld_1", FP_B)).toBe(1);
    expect(await repo.countHoldDecisionsForFingerprint("fld_1", FP_B)).toBe(0);
  });

  it("supports two fingerprints on the same folder independently", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createAnalysisAttemptRepository(prisma as never);

    await repo.recordAnalysisAttempt(
      acceptedInput({ aggregateFingerprint: FP_A, attemptNumber: 1 }),
    );
    await repo.recordAnalysisAttempt(
      acceptedInput({ aggregateFingerprint: FP_B, attemptNumber: 1 }),
    );

    const listA = await repo.listAnalysisAttemptsForFolder("fld_1", {
      aggregateFingerprint: FP_A,
    });
    const listB = await repo.listAnalysisAttemptsForFolder("fld_1", {
      aggregateFingerprint: FP_B,
    });

    expect(listA).toHaveLength(1);
    expect(listB).toHaveLength(1);
    expect(listA[0]!.aggregateFingerprint).toBe(FP_A);
    expect(listB[0]!.aggregateFingerprint).toBe(FP_B);
  });

  it("refuses a missing folder", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createAnalysisAttemptRepository(prisma as never);

    await expect(
      repo.recordAnalysisAttempt(
        acceptedInput({ folderId: "missing_folder" }),
      ),
    ).rejects.toBeInstanceOf(AnalysisIntegrityError);
  });

  it("refuses a duplicated attempt number for the same fingerprint", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createAnalysisAttemptRepository(prisma as never);

    await repo.recordAnalysisAttempt(acceptedInput({ attemptNumber: 1 }));

    await expect(
      repo.recordAnalysisAttempt(acceptedInput({ attemptNumber: 1 })),
    ).rejects.toBeInstanceOf(AnalysisIntegrityError);
  });

  it("refuses an invalid fingerprint", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createAnalysisAttemptRepository(prisma as never);

    await expect(
      repo.recordAnalysisAttempt(
        acceptedInput({ aggregateFingerprint: "not-a-sha256" }),
      ),
    ).rejects.toBeInstanceOf(AnalysisIntegrityError);

    await expect(
      repo.countAttemptsForFingerprint("fld_1", "short"),
    ).rejects.toBeInstanceOf(AnalysisIntegrityError);
  });

  it("refuses accepted without scoring and rejected with scoring", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createAnalysisAttemptRepository(prisma as never);

    await expect(
      repo.recordAnalysisAttempt(
        acceptedInput({ backendScoring: null }),
      ),
    ).rejects.toBeInstanceOf(AnalysisIntegrityError);

    await expect(
      repo.recordAnalysisAttempt({
        folderId: "fld_1",
        aggregateFingerprint: FP_A,
        attemptNumber: 1,
        validationStatus: "rejected",
        proposal: sampleProposal(),
        backendScoring: sampleScoring(),
        errorCodes: ["schema_violation"],
      }),
    ).rejects.toBeInstanceOf(AnalysisIntegrityError);
  });

  it("refuses publish without an accepted analysis", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createAnalysisAttemptRepository(prisma as never);

    await expect(
      repo.recordAnalysisAttempt({
        folderId: "fld_1",
        aggregateFingerprint: FP_A,
        attemptNumber: 1,
        validationStatus: "rejected",
        proposal: null,
        backendScoring: null,
        errorCodes: ["invalid_json"],
        publicationDecision: "publish",
      }),
    ).rejects.toBeInstanceOf(AnalysisIntegrityError);

    await expect(
      repo.recordAnalysisAttempt({
        folderId: "fld_1",
        aggregateFingerprint: FP_A,
        attemptNumber: 1,
        validationStatus: "rejected",
        proposal: null,
        backendScoring: null,
        errorCodes: ["invalid_json"],
        publicationDecision: "enrich_thread_only",
      }),
    ).rejects.toBeInstanceOf(AnalysisIntegrityError);
  });

  it("preserves AnalysisProposalV1 exactly and closed enums", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createAnalysisAttemptRepository(prisma as never);
    const proposal = sampleProposal({
      entities: ["OpenAI", "ChatGPT"],
      proposedFacts: [
        { key: "product", value: "ChatGPT", support: "explicit" },
      ],
    });

    const row = await repo.recordAnalysisAttempt(
      acceptedInput({
        proposal,
        warnings: ["entities_deduplicated"],
        droppedFacts: [
          { key: "rumor", value: "soon", support: "inferred" },
        ],
        errorCodes: [],
      }),
    );

    const loaded = await repo.getAnalysisAttemptById(row.id);
    expect(loaded?.proposal).toEqual(proposal);
    expect(loaded?.warnings).toEqual(["entities_deduplicated"]);
    expect(loaded?.droppedFacts).toEqual([
      { key: "rumor", value: "soon", support: "inferred" },
    ]);
  });

  it("lists attempts in deterministic newest-first order by default", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createAnalysisAttemptRepository(prisma as never);

    await repo.recordAnalysisAttempt(acceptedInput({ attemptNumber: 1 }));
    await repo.recordAnalysisAttempt(acceptedInput({ attemptNumber: 2 }));
    await repo.recordAnalysisAttempt(acceptedInput({ attemptNumber: 3 }));

    const desc = await repo.listAnalysisAttemptsForFolder("fld_1");
    expect(desc.map((row) => row.attemptNumber)).toEqual([3, 2, 1]);

    const asc = await repo.listAnalysisAttemptsForFolder("fld_1", {
      order: "asc",
    });
    expect(asc.map((row) => row.attemptNumber)).toEqual([1, 2, 3]);
  });

  it("exposes no destructive delete on the public repository API", () => {
    const { prisma, analysisAttempt } = createPrismaDouble();
    const repo = createAnalysisAttemptRepository(prisma as never);

    expect(repo).not.toHaveProperty("delete");
    expect(repo).not.toHaveProperty("deleteAnalysisAttempt");
    expect(repo).not.toHaveProperty("update");
    expect(typeof repo.recordAnalysisAttempt).toBe("function");
    expect(analysisAttempt.delete).not.toHaveBeenCalled();
  });

  it("refuses accepted without proposal and rejected pre-parse without errors", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createAnalysisAttemptRepository(prisma as never);

    await expect(
      repo.recordAnalysisAttempt(
        acceptedInput({ proposal: null }),
      ),
    ).rejects.toBeInstanceOf(AnalysisIntegrityError);

    await expect(
      repo.recordAnalysisAttempt({
        folderId: "fld_1",
        aggregateFingerprint: FP_A,
        attemptNumber: 1,
        validationStatus: "rejected",
        proposal: null,
        backendScoring: null,
        errorCodes: [],
      }),
    ).rejects.toBeInstanceOf(AnalysisIntegrityError);
  });

  it("refuses non-v1 schemaVersion and non-positive attemptNumber", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createAnalysisAttemptRepository(prisma as never);

    await expect(
      repo.recordAnalysisAttempt(
        acceptedInput({
          schemaVersion: "2" as unknown as "1",
        }),
      ),
    ).rejects.toBeInstanceOf(AnalysisIntegrityError);

    await expect(
      repo.recordAnalysisAttempt(acceptedInput({ attemptNumber: 0 })),
    ).rejects.toBeInstanceOf(AnalysisIntegrityError);
  });
});
