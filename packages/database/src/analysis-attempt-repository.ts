import type { Prisma, PrismaClient } from "@prisma/client";

import type {
  AnalysisAttemptRecord,
  AnalysisProposalV1,
  BackendScoringV1,
  ListAnalysisAttemptsOptions,
  ProposedFactV1,
  RecordAnalysisAttemptInput,
} from "./analysis-types.js";
import {
  AnalysisIntegrityError,
  SHA256_HEX_PATTERN,
} from "./analysis-types.js";

export interface AnalysisAttemptRepository {
  /**
   * Append-only create of an analysis attempt (success or failure).
   * Does not choose publication / scoring / fingerprint — caller provides them.
   */
  recordAnalysisAttempt(
    input: RecordAnalysisAttemptInput,
  ): Promise<AnalysisAttemptRecord>;

  /** Read one attempt by technical id. */
  getAnalysisAttemptById(id: string): Promise<AnalysisAttemptRecord | null>;

  /**
   * List attempts for a folder.
   * Default order: newest first (`analyzedAt` desc, then `createdAt` desc, `id` desc).
   */
  listAnalysisAttemptsForFolder(
    folderId: string,
    options?: ListAnalysisAttemptsOptions,
  ): Promise<AnalysisAttemptRecord[]>;

  /** Latest attempt for a folder (any status), or null. */
  getLatestAnalysisAttempt(
    folderId: string,
  ): Promise<AnalysisAttemptRecord | null>;

  /**
   * Latest accepted analysis (`accepted` | `accepted_with_warnings`) for a folder.
   * Rejected attempts are never returned.
   */
  getLatestAcceptedAnalysis(
    folderId: string,
  ): Promise<AnalysisAttemptRecord | null>;

  /** Latest accepted analysis for a given aggregate fingerprint. */
  getLatestAcceptedAnalysisForFingerprint(
    folderId: string,
    aggregateFingerprint: string,
  ): Promise<AnalysisAttemptRecord | null>;

  /** Count attempts for (folderId, aggregateFingerprint). */
  countAttemptsForFingerprint(
    folderId: string,
    aggregateFingerprint: string,
  ): Promise<number>;

  /** Count `hold` publication decisions for (folderId, aggregateFingerprint). */
  countHoldDecisionsForFingerprint(
    folderId: string,
    aggregateFingerprint: string,
  ): Promise<number>;
}

type AnalysisAttemptRow = {
  id: string;
  folderId: string;
  aggregateFingerprint: string;
  attemptNumber: number;
  analyzedAt: Date;
  modelId: string | null;
  proposalOrigin: string;
  validationStatus: AnalysisAttemptRecord["validationStatus"];
  proposal: Prisma.JsonValue | null;
  backendScoring: Prisma.JsonValue | null;
  errorCodes: AnalysisAttemptRecord["errorCodes"];
  warnings: AnalysisAttemptRecord["warnings"];
  droppedFacts: Prisma.JsonValue;
  publicationDecision: AnalysisAttemptRecord["publicationDecision"];
  createdAt: Date;
};

function assertSha256Fingerprint(value: string): void {
  if (!SHA256_HEX_PATTERN.test(value)) {
    throw new AnalysisIntegrityError(
      `aggregateFingerprint must be a SHA-256 hex digest (64 hex chars); got length ${value.length}`,
    );
  }
}

function assertProposalShape(
  proposal: AnalysisProposalV1,
): asserts proposal is AnalysisProposalV1 {
  if (proposal.schemaVersion !== "1") {
    throw new AnalysisIntegrityError(
      `proposal.schemaVersion must be "1"; got ${String(proposal.schemaVersion)}`,
    );
  }
}

function validateRecordInput(input: RecordAnalysisAttemptInput): {
  proposal: AnalysisProposalV1 | null;
  backendScoring: BackendScoringV1 | null;
  errorCodes: AnalysisAttemptRecord["errorCodes"];
  warnings: AnalysisAttemptRecord["warnings"];
  droppedFacts: ProposedFactV1[];
  publicationDecision: AnalysisAttemptRecord["publicationDecision"];
  proposalOrigin: AnalysisAttemptRecord["proposalOrigin"];
} {
  if (input.schemaVersion !== undefined && input.schemaVersion !== "1") {
    throw new AnalysisIntegrityError(
      `schemaVersion must be "1"; got ${String(input.schemaVersion)}`,
    );
  }

  if (typeof input.folderId !== "string" || input.folderId.trim() === "") {
    throw new AnalysisIntegrityError("folderId must be a non-empty string");
  }

  assertSha256Fingerprint(input.aggregateFingerprint);

  if (
    !Number.isInteger(input.attemptNumber) ||
    input.attemptNumber <= 0
  ) {
    throw new AnalysisIntegrityError(
      `attemptNumber must be a strictly positive integer; got ${String(input.attemptNumber)}`,
    );
  }

  if (
    input.proposalOrigin !== undefined &&
    input.proposalOrigin !== "llm" &&
    input.proposalOrigin !== "llm_analysis" &&
    input.proposalOrigin !== "deterministic_fallback"
  ) {
    throw new AnalysisIntegrityError(
      `proposalOrigin must be "llm", "llm_analysis", or "deterministic_fallback"; got ${String(input.proposalOrigin)}`,
    );
  }

  const proposal = input.proposal ?? null;
  const backendScoring = input.backendScoring ?? null;
  const errorCodes = input.errorCodes ? [...input.errorCodes] : [];
  const warnings = input.warnings ? [...input.warnings] : [];
  const droppedFacts = input.droppedFacts ? [...input.droppedFacts] : [];
  const publicationDecision = input.publicationDecision ?? null;
  const status = input.validationStatus;

  if (proposal !== null) {
    assertProposalShape(proposal);
  }

  if (status === "accepted" || status === "accepted_with_warnings") {
    if (proposal === null) {
      throw new AnalysisIntegrityError(
        `${status} requires a parseable proposal`,
      );
    }
    if (backendScoring === null) {
      throw new AnalysisIntegrityError(
        `${status} requires backendScoring`,
      );
    }
  }

  if (status === "rejected") {
    if (backendScoring !== null) {
      throw new AnalysisIntegrityError(
        "rejected analysis must not include backendScoring",
      );
    }
    if (proposal === null && errorCodes.length === 0) {
      throw new AnalysisIntegrityError(
        "rejected analysis without proposal requires at least one pre-parse error code",
      );
    }
  }

  if (
    publicationDecision === "publish" ||
    publicationDecision === "enrich_thread_only"
  ) {
    if (status !== "accepted" && status !== "accepted_with_warnings") {
      throw new AnalysisIntegrityError(
        `publicationDecision ${publicationDecision} requires an accepted analysis`,
      );
    }
  }

  const proposalOrigin =
    input.proposalOrigin === "deterministic_fallback"
      ? "deterministic_fallback"
      : input.proposalOrigin === "llm_analysis"
        ? "llm_analysis"
        : "llm";

  return {
    proposal,
    backendScoring,
    errorCodes,
    warnings,
    droppedFacts,
    publicationDecision,
    proposalOrigin,
  };
}

function mapRow(row: AnalysisAttemptRow): AnalysisAttemptRecord {
  if (
    row.proposalOrigin !== "llm" &&
    row.proposalOrigin !== "llm_analysis" &&
    row.proposalOrigin !== "deterministic_fallback"
  ) {
    throw new AnalysisIntegrityError(
      `Persisted proposalOrigin unsupported: ${row.proposalOrigin}`,
    );
  }

  return {
    id: row.id,
    folderId: row.folderId,
    aggregateFingerprint: row.aggregateFingerprint,
    attemptNumber: row.attemptNumber,
    analyzedAt: row.analyzedAt,
    modelId: row.modelId,
    proposalOrigin: row.proposalOrigin,
    validationStatus: row.validationStatus,
    proposal: (row.proposal as unknown as AnalysisProposalV1 | null) ?? null,
    backendScoring:
      (row.backendScoring as unknown as BackendScoringV1 | null) ?? null,
    errorCodes: [...row.errorCodes],
    warnings: [...row.warnings],
    droppedFacts: Array.isArray(row.droppedFacts)
      ? (row.droppedFacts as unknown as ProposedFactV1[])
      : [],
    publicationDecision: row.publicationDecision,
    createdAt: row.createdAt,
  };
}

const ACCEPTED_STATUSES = ["accepted", "accepted_with_warnings"] as const;

/**
 * Factory for the analysis attempt repository (007.1B).
 * Persistence only — no Ollama, scoring, fingerprint, or publication logic.
 * Prisma client is injected for testability.
 */
export function createAnalysisAttemptRepository(
  prisma: PrismaClient,
): AnalysisAttemptRepository {
  return {
    async recordAnalysisAttempt(input) {
      const validated = validateRecordInput(input);

      const folder = await prisma.newsFolder.findUnique({
        where: { id: input.folderId },
        select: { id: true },
      });
      if (folder === null) {
        throw new AnalysisIntegrityError(
          `Cannot record analysis attempt: news folder ${input.folderId} does not exist`,
        );
      }

      const duplicate = await prisma.analysisAttempt.findUnique({
        where: {
          folderId_aggregateFingerprint_attemptNumber: {
            folderId: input.folderId,
            aggregateFingerprint: input.aggregateFingerprint,
            attemptNumber: input.attemptNumber,
          },
        },
        select: { id: true },
      });
      if (duplicate !== null) {
        throw new AnalysisIntegrityError(
          `Duplicate attemptNumber ${input.attemptNumber} for folder ${input.folderId} and fingerprint ${input.aggregateFingerprint}`,
        );
      }

      const row = await prisma.analysisAttempt.create({
        data: {
          folderId: input.folderId,
          aggregateFingerprint: input.aggregateFingerprint,
          attemptNumber: input.attemptNumber,
          analyzedAt: input.analyzedAt ?? new Date(),
          modelId: input.modelId ?? null,
          proposalOrigin: validated.proposalOrigin,
          validationStatus: input.validationStatus,
          proposal:
            validated.proposal === null
              ? undefined
              : (validated.proposal as unknown as Prisma.InputJsonValue),
          backendScoring:
            validated.backendScoring === null
              ? undefined
              : (validated.backendScoring as unknown as Prisma.InputJsonValue),
          errorCodes: validated.errorCodes,
          warnings: validated.warnings,
          droppedFacts:
            validated.droppedFacts as unknown as Prisma.InputJsonValue,
          publicationDecision: validated.publicationDecision,
        },
      });

      return mapRow(row as AnalysisAttemptRow);
    },

    async getAnalysisAttemptById(id) {
      const row = await prisma.analysisAttempt.findUnique({ where: { id } });
      return row === null ? null : mapRow(row as AnalysisAttemptRow);
    },

    async listAnalysisAttemptsForFolder(folderId, options = {}) {
      const order = options.order ?? "desc";
      const rows = await prisma.analysisAttempt.findMany({
        where: {
          folderId,
          ...(options.aggregateFingerprint !== undefined
            ? { aggregateFingerprint: options.aggregateFingerprint }
            : {}),
        },
        orderBy: [
          { analyzedAt: order },
          { createdAt: order },
          { id: order },
        ],
      });
      return rows.map((row) => mapRow(row as AnalysisAttemptRow));
    },

    async getLatestAnalysisAttempt(folderId) {
      const row = await prisma.analysisAttempt.findFirst({
        where: { folderId },
        orderBy: [{ analyzedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      });
      return row === null ? null : mapRow(row as AnalysisAttemptRow);
    },

    async getLatestAcceptedAnalysis(folderId) {
      const row = await prisma.analysisAttempt.findFirst({
        where: {
          folderId,
          validationStatus: { in: [...ACCEPTED_STATUSES] },
        },
        orderBy: [{ analyzedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      });
      return row === null ? null : mapRow(row as AnalysisAttemptRow);
    },

    async getLatestAcceptedAnalysisForFingerprint(
      folderId,
      aggregateFingerprint,
    ) {
      assertSha256Fingerprint(aggregateFingerprint);
      const row = await prisma.analysisAttempt.findFirst({
        where: {
          folderId,
          aggregateFingerprint,
          validationStatus: { in: [...ACCEPTED_STATUSES] },
        },
        orderBy: [{ analyzedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      });
      return row === null ? null : mapRow(row as AnalysisAttemptRow);
    },

    async countAttemptsForFingerprint(folderId, aggregateFingerprint) {
      assertSha256Fingerprint(aggregateFingerprint);
      return prisma.analysisAttempt.count({
        where: { folderId, aggregateFingerprint },
      });
    },

    async countHoldDecisionsForFingerprint(folderId, aggregateFingerprint) {
      assertSha256Fingerprint(aggregateFingerprint);
      return prisma.analysisAttempt.count({
        where: {
          folderId,
          aggregateFingerprint,
          publicationDecision: "hold",
        },
      });
    },
  };
}
