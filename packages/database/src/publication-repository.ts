import type { PrismaClient } from "@prisma/client";

import {
  PUBLICATION_STATUS_TRANSITIONS,
  PublicationPersistenceError,
  buildPublishIdempotencyKey,
  computeHasMainPublication,
  type FolderPublicationRecord,
  type GetOrCreateFolderPublicationInput,
  type ListPublicationAttemptsOptions,
  type ListRetryablePublicationOptions,
  type PublicationAttemptRecord,
  type PublicationAttemptStatus,
  type PublicationErrorCode,
  type PublicationOperationKind,
  type PublicationStatus,
  type RecordEnrichmentPublishedInput,
  type RecordMainPublicationSuccessInput,
  type RecordPublicationFailureInput,
  type RecordThreadCreatedInput,
  type ReservePublicationOperationInput,
  type ReservePublicationOutcome,
  type ReservePublishInput,
} from "./publication-types.js";

export interface PublicationRepository {
  /** Create or return the current FolderPublication for a folder. */
  getOrCreateFolderPublication(
    input: GetOrCreateFolderPublicationInput,
  ): Promise<FolderPublicationRecord>;

  /** Atomic reservation of a main publish (P01). */
  reservePublish(input: ReservePublishInput): Promise<ReservePublicationOutcome>;

  /** Reserve create_thread / enrich / unarchive / reconcile. */
  reserveOperation(
    input: ReservePublicationOperationInput,
  ): Promise<ReservePublicationOutcome>;

  /** Persist main message (+ optional thread) after Discord success. */
  recordMainPublicationSuccess(
    input: RecordMainPublicationSuccessInput,
  ): Promise<{
    publication: FolderPublicationRecord;
    attempt: PublicationAttemptRecord | null;
  }>;

  /** Persist thread id after create_thread (partial → main_published). */
  recordThreadCreated(input: RecordThreadCreatedInput): Promise<{
    publication: FolderPublicationRecord;
    attempt: PublicationAttemptRecord | null;
  }>;

  /** Persist enrichment published in the thread. */
  recordEnrichmentPublished(input: RecordEnrichmentPublishedInput): Promise<{
    publication: FolderPublicationRecord;
    attempt: PublicationAttemptRecord | null;
  }>;

  /** Record a normalized failure on an attempt. */
  recordFailure(input: RecordPublicationFailureInput): Promise<{
    publication: FolderPublicationRecord;
    attempt: PublicationAttemptRecord;
  }>;

  getPublicationByFolder(
    folderId: string,
  ): Promise<FolderPublicationRecord | null>;

  listAttemptsForFolder(
    folderId: string,
    options?: ListPublicationAttemptsOptions,
  ): Promise<PublicationAttemptRecord[]>;

  findAttemptByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<PublicationAttemptRecord | null>;

  /** Active (reserved|succeeded) attempt for a key, if any. */
  findActiveAttemptByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<PublicationAttemptRecord | null>;

  /** Reserved / failed-retryable attempts ready to replay. */
  listRetryableAttempts(
    options?: ListRetryablePublicationOptions,
  ): Promise<PublicationAttemptRecord[]>;

  /** Bounded oldest-first folders whose partial state can be resumed. */
  listPublicationsNeedingResume(options?: {
    take?: number;
  }): Promise<FolderPublicationRecord[]>;

  /**
   * Claim exclusive Discord execution for a reserved attempt (010.1A AUD-002).
   * Returns null when another holder still holds a valid lease.
   */
  claimExecution(input: {
    attemptId: string;
    holderId: string;
    leaseMs: number;
    now?: Date;
  }): Promise<PublicationAttemptRecord | null>;

  /** Clear execution lease after Discord I/O completes or fails. */
  clearExecutionLease(input: {
    attemptId: string;
    holderId: string;
  }): Promise<PublicationAttemptRecord | null>;
}

type FolderPublicationRow = {
  id: string;
  folderId: string;
  status: PublicationStatus;
  guildId: string;
  channelId: string | null;
  mainMessageId: string | null;
  threadId: string | null;
  sourceAnalysisAttemptId: string | null;
  lastErrorCode: PublicationErrorCode | null;
  createdAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
};

type PublicationAttemptRow = {
  id: string;
  folderPublicationId: string;
  folderId: string;
  kind: PublicationOperationKind;
  attemptNumber: number;
  idempotencyKey: string;
  analysisAttemptId: string | null;
  eventFingerprint: string | null;
  status: PublicationAttemptStatus;
  discordMessageId: string | null;
  discordThreadId: string | null;
  errorCode: PublicationErrorCode | null;
  retryable: boolean;
  nextAttemptAt: Date | null;
  durationMs: number | null;
  executionHolderId: string | null;
  executionLeaseExpiresAt: Date | null;
  attemptedAt: Date;
  createdAt: Date;
};

function mapPublication(row: FolderPublicationRow): FolderPublicationRecord {
  return {
    id: row.id,
    folderId: row.folderId,
    status: row.status,
    guildId: row.guildId,
    channelId: row.channelId,
    mainMessageId: row.mainMessageId,
    threadId: row.threadId,
    sourceAnalysisAttemptId: row.sourceAnalysisAttemptId,
    lastErrorCode: row.lastErrorCode,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastActivityAt: row.lastActivityAt,
    hasMainPublication: computeHasMainPublication(
      row.status,
      row.mainMessageId,
    ),
  };
}

function mapAttempt(row: PublicationAttemptRow): PublicationAttemptRecord {
  return {
    id: row.id,
    folderPublicationId: row.folderPublicationId,
    folderId: row.folderId,
    kind: row.kind,
    attemptNumber: row.attemptNumber,
    idempotencyKey: row.idempotencyKey,
    analysisAttemptId: row.analysisAttemptId,
    eventFingerprint: row.eventFingerprint,
    status: row.status,
    discordMessageId: row.discordMessageId,
    discordThreadId: row.discordThreadId,
    errorCode: row.errorCode,
    retryable: row.retryable,
    nextAttemptAt: row.nextAttemptAt,
    durationMs: row.durationMs,
    executionHolderId: row.executionHolderId ?? null,
    executionLeaseExpiresAt: row.executionLeaseExpiresAt ?? null,
    attemptedAt: row.attemptedAt,
    createdAt: row.createdAt,
  };
}

function assertNonEmpty(
  value: string,
  field: string,
  code:
    | "invalid_idempotency_key"
    | "inconsistent_state" = "inconsistent_state",
): void {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PublicationPersistenceError(
      code,
      `${field} must be a non-empty string`,
    );
  }
}

function assertIdempotencyKey(key: string): void {
  assertNonEmpty(key, "idempotencyKey", "invalid_idempotency_key");
  if (key.length > 512) {
    throw new PublicationPersistenceError(
      "invalid_idempotency_key",
      `idempotencyKey exceeds 512 characters (got ${key.length})`,
    );
  }
}

function assertPositiveAttemptNumber(n: number): void {
  if (!Number.isInteger(n) || n <= 0) {
    throw new PublicationPersistenceError(
      "inconsistent_state",
      `attemptNumber must be a strictly positive integer; got ${String(n)}`,
    );
  }
}

function assertTransition(
  from: PublicationStatus,
  to: PublicationStatus,
): void {
  const allowed = PUBLICATION_STATUS_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new PublicationPersistenceError(
      "forbidden_status_transition",
      `Forbidden PublicationStatus transition ${from} → ${to}`,
    );
  }
}

/** Discord snowflakes are stored as strings; format validation is not gel-mandated. */
function assertSnowflake(value: string, field: string): void {
  assertNonEmpty(value, field);
}

type TxClient = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

async function requireOpenFolder(
  prisma: PrismaClient | TxClient,
  folderId: string,
): Promise<{ id: string; status: string }> {
  const folder = await prisma.newsFolder.findUnique({
    where: { id: folderId },
    select: { id: true, status: true },
  });
  if (folder === null) {
    throw new PublicationPersistenceError(
      "folder_absent",
      `News folder ${folderId} does not exist`,
    );
  }
  if (folder.status === "closed") {
    throw new PublicationPersistenceError(
      "folder_closed",
      `News folder ${folderId} is closed; automatic publication is refused`,
    );
  }
  return folder;
}

async function loadPublicationByFolder(
  prisma: PrismaClient | TxClient,
  folderId: string,
): Promise<FolderPublicationRow | null> {
  return prisma.folderPublication.findUnique({
    where: { folderId },
  }) as Promise<FolderPublicationRow | null>;
}

async function resolveAttempt(
  prisma: PrismaClient | TxClient,
  input: {
    attemptId?: string;
    idempotencyKey?: string;
    folderId: string;
  },
): Promise<PublicationAttemptRow> {
  if (input.attemptId !== undefined) {
    const row = (await prisma.publicationAttempt.findUnique({
      where: { id: input.attemptId },
    })) as PublicationAttemptRow | null;
    if (row === null || row.folderId !== input.folderId) {
      throw new PublicationPersistenceError(
        "inconsistent_state",
        `Publication attempt ${input.attemptId} not found for folder ${input.folderId}`,
      );
    }
    return row;
  }
  if (input.idempotencyKey !== undefined) {
    assertIdempotencyKey(input.idempotencyKey);
    const row = (await prisma.publicationAttempt.findFirst({
      where: {
        folderId: input.folderId,
        idempotencyKey: input.idempotencyKey,
        status: { in: ["reserved", "succeeded"] },
      },
      orderBy: [{ attemptNumber: "desc" }, { createdAt: "desc" }],
    })) as PublicationAttemptRow | null;
    if (row === null) {
      throw new PublicationPersistenceError(
        "inconsistent_state",
        `No active publication attempt for idempotencyKey ${input.idempotencyKey}`,
      );
    }
    return row;
  }
  throw new PublicationPersistenceError(
    "invalid_idempotency_key",
    "attemptId or idempotencyKey is required",
  );
}

/**
 * Factory for the Discord publication persistence repository (008.1B).
 * Persistence / reservation only — no Discord calls, embeds, or publish decisions.
 */
export function createPublicationRepository(
  prisma: PrismaClient,
): PublicationRepository {
  return {
    async getOrCreateFolderPublication(input) {
      assertNonEmpty(input.folderId, "folderId");
      assertSnowflake(input.guildId, "guildId");
      await requireOpenFolder(prisma, input.folderId);

      const existing = await loadPublicationByFolder(prisma, input.folderId);
      if (existing !== null) {
        return mapPublication(existing);
      }

      try {
        const created = (await prisma.folderPublication.create({
          data: {
            folderId: input.folderId,
            guildId: input.guildId,
            status: "none",
            lastActivityAt: new Date(),
          },
        })) as FolderPublicationRow;
        return mapPublication(created);
      } catch (error) {
        const raced = await loadPublicationByFolder(prisma, input.folderId);
        if (raced !== null) {
          return mapPublication(raced);
        }
        throw error;
      }
    },

    async reservePublish(input) {
      assertNonEmpty(input.folderId, "folderId");
      assertSnowflake(input.guildId, "guildId");
      const idempotencyKey =
        input.idempotencyKey ?? buildPublishIdempotencyKey(input.folderId);
      assertIdempotencyKey(idempotencyKey);

      return prisma.$transaction(async (tx) => {
        await requireOpenFolder(tx, input.folderId);

        let publication = await loadPublicationByFolder(tx, input.folderId);
        if (publication === null) {
          publication = (await tx.folderPublication.create({
            data: {
              folderId: input.folderId,
              guildId: input.guildId,
              status: "none",
              lastActivityAt: new Date(),
            },
          })) as FolderPublicationRow;
        }

        if (
          computeHasMainPublication(
            publication.status,
            publication.mainMessageId,
          )
        ) {
          const existing = (await tx.publicationAttempt.findFirst({
            where: {
              folderId: input.folderId,
              idempotencyKey,
              status: "succeeded",
            },
            orderBy: [{ attemptNumber: "desc" }],
          })) as PublicationAttemptRow | null;

          if (existing !== null) {
            return {
              kind: "idempotent_hit" as const,
              publication: mapPublication(publication),
              attempt: mapAttempt(existing),
              reason: "already_published" as const,
            };
          }

          throw new PublicationPersistenceError(
            "main_already_reserved_or_exists",
            `Folder ${input.folderId} already has a main publication`,
          );
        }

        const active = (await tx.publicationAttempt.findFirst({
          where: {
            idempotencyKey,
            status: { in: ["reserved", "succeeded"] },
          },
          orderBy: [{ attemptNumber: "desc" }],
        })) as PublicationAttemptRow | null;

        if (active !== null) {
          return {
            kind: "idempotent_hit" as const,
            publication: mapPublication(publication),
            attempt: mapAttempt(active),
            reason:
              active.status === "succeeded"
                ? ("already_succeeded" as const)
                : ("already_reserved" as const),
          };
        }

        if (publication.status === "pending") {
          const pendingAttempt = (await tx.publicationAttempt.findFirst({
            where: {
              folderId: input.folderId,
              kind: "publish",
              status: "reserved",
            },
            orderBy: [{ attemptNumber: "desc" }],
          })) as PublicationAttemptRow | null;
          if (pendingAttempt !== null) {
            return {
              kind: "idempotent_hit" as const,
              publication: mapPublication(publication),
              attempt: mapAttempt(pendingAttempt),
              reason: "already_reserved" as const,
            };
          }
        }

        if (publication.status !== "pending") {
          assertTransition(publication.status, "pending");
          publication = (await tx.folderPublication.update({
            where: { id: publication.id },
            data: {
              status: "pending",
              guildId: input.guildId,
              sourceAnalysisAttemptId: input.analysisAttemptId ?? null,
              lastErrorCode: null,
              lastActivityAt: new Date(),
            },
          })) as FolderPublicationRow;
        }

        const lastAttempt = (await tx.publicationAttempt.findFirst({
          where: { idempotencyKey },
          orderBy: [{ attemptNumber: "desc" }],
          select: { attemptNumber: true },
        })) as { attemptNumber: number } | null;
        const attemptNumber = (lastAttempt?.attemptNumber ?? 0) + 1;
        assertPositiveAttemptNumber(attemptNumber);

        const attempt = (await tx.publicationAttempt.create({
          data: {
            folderPublicationId: publication.id,
            folderId: input.folderId,
            kind: "publish",
            attemptNumber,
            idempotencyKey,
            analysisAttemptId: input.analysisAttemptId ?? null,
            status: "reserved",
            retryable: false,
            attemptedAt: new Date(),
          },
        })) as PublicationAttemptRow;

        return {
          kind: "reserved" as const,
          publication: mapPublication(publication),
          attempt: mapAttempt(attempt),
        };
      });
    },

    async reserveOperation(input) {
      assertNonEmpty(input.folderId, "folderId");
      assertIdempotencyKey(input.idempotencyKey);
      const attemptNumber = input.attemptNumber ?? 1;
      assertPositiveAttemptNumber(attemptNumber);

      if (input.kind === "enrich") {
        if (
          input.eventFingerprint === undefined ||
          input.eventFingerprint === null ||
          input.eventFingerprint.trim() === ""
        ) {
          throw new PublicationPersistenceError(
            "enrichment_precondition_failed",
            "enrich reservation requires a non-empty eventFingerprint",
          );
        }
      }

      return prisma.$transaction(async (tx) => {
        await requireOpenFolder(tx, input.folderId);

        const publication = await loadPublicationByFolder(tx, input.folderId);
        if (publication === null) {
          throw new PublicationPersistenceError(
            "enrichment_precondition_failed",
            `No FolderPublication for folder ${input.folderId}`,
          );
        }

        if (input.kind === "enrich" || input.kind === "create_thread") {
          if (
            !computeHasMainPublication(
              publication.status,
              publication.mainMessageId,
            )
          ) {
            throw new PublicationPersistenceError(
              "enrichment_precondition_failed",
              `Folder ${input.folderId} has no main publication; cannot ${input.kind}`,
            );
          }
        }

        if (input.kind === "create_thread" && publication.mainMessageId === null) {
          throw new PublicationPersistenceError(
            "enrichment_precondition_failed",
            `Folder ${input.folderId} has no mainMessageId for create_thread`,
          );
        }

        const active = (await tx.publicationAttempt.findFirst({
          where: {
            idempotencyKey: input.idempotencyKey,
            status: { in: ["reserved", "succeeded"] },
          },
          orderBy: [{ attemptNumber: "desc" }],
        })) as PublicationAttemptRow | null;

        if (active !== null) {
          return {
            kind: "idempotent_hit" as const,
            publication: mapPublication(publication),
            attempt: mapAttempt(active),
            reason:
              active.status === "succeeded"
                ? ("already_succeeded" as const)
                : ("already_reserved" as const),
          };
        }

        const lastAttempt = (await tx.publicationAttempt.findFirst({
          where: { idempotencyKey: input.idempotencyKey },
          orderBy: [{ attemptNumber: "desc" }],
          select: { attemptNumber: true },
        })) as { attemptNumber: number } | null;
        const nextNumber = Math.max(
          attemptNumber,
          (lastAttempt?.attemptNumber ?? 0) + 1,
        );

        const attempt = (await tx.publicationAttempt.create({
          data: {
            folderPublicationId: publication.id,
            folderId: input.folderId,
            kind: input.kind,
            attemptNumber: nextNumber,
            idempotencyKey: input.idempotencyKey,
            analysisAttemptId: input.analysisAttemptId ?? null,
            eventFingerprint: input.eventFingerprint ?? null,
            status: "reserved",
            retryable: false,
            attemptedAt: new Date(),
          },
        })) as PublicationAttemptRow;

        return {
          kind: "reserved" as const,
          publication: mapPublication(publication),
          attempt: mapAttempt(attempt),
        };
      });
    },

    async recordMainPublicationSuccess(input) {
      assertNonEmpty(input.folderId, "folderId");
      assertSnowflake(input.guildId, "guildId");
      assertSnowflake(input.channelId, "channelId");
      assertSnowflake(input.mainMessageId, "mainMessageId");
      if (input.threadId != null) {
        assertSnowflake(input.threadId, "threadId");
      }

      return prisma.$transaction(async (tx) => {
        const publication = await loadPublicationByFolder(tx, input.folderId);
        if (publication === null) {
          throw new PublicationPersistenceError(
            "inconsistent_state",
            `No FolderPublication for folder ${input.folderId}`,
          );
        }

        const nextStatus: PublicationStatus =
          input.threadId != null ? "main_published" : "partial";

        if (publication.status !== nextStatus) {
          if (
            publication.status === "pending" ||
            publication.status === "partial"
          ) {
            assertTransition(publication.status, nextStatus);
          } else if (publication.status === nextStatus) {
            // idempotent re-persist
          } else if (
            publication.status === "main_published" &&
            nextStatus === "main_published"
          ) {
            // idempotent
          } else {
            assertTransition(publication.status, nextStatus);
          }
        }

        const updated = (await tx.folderPublication.update({
          where: { id: publication.id },
          data: {
            status: nextStatus,
            guildId: input.guildId,
            channelId: input.channelId,
            mainMessageId: input.mainMessageId,
            threadId: input.threadId ?? null,
            sourceAnalysisAttemptId:
              input.analysisAttemptId ?? publication.sourceAnalysisAttemptId,
            lastErrorCode: null,
            lastActivityAt: new Date(),
          },
        })) as FolderPublicationRow;

        let attempt: PublicationAttemptRow | null = null;
        if (
          input.attemptId !== undefined ||
          input.idempotencyKey !== undefined
        ) {
          const current = await resolveAttempt(tx, {
            folderId: input.folderId,
            attemptId: input.attemptId,
            idempotencyKey: input.idempotencyKey,
          });
          if (current.status === "reserved") {
            attempt = (await tx.publicationAttempt.update({
              where: { id: current.id },
              data: {
                status: "succeeded",
                discordMessageId: input.mainMessageId,
                discordThreadId: input.threadId ?? null,
                errorCode: null,
                retryable: false,
                nextAttemptAt: null,
                durationMs: input.durationMs ?? null,
                attemptedAt: new Date(),
              },
            })) as PublicationAttemptRow;
          } else {
            attempt = current;
          }
        }

        return {
          publication: mapPublication(updated),
          attempt: attempt === null ? null : mapAttempt(attempt),
        };
      });
    },

    async recordThreadCreated(input) {
      assertNonEmpty(input.folderId, "folderId");
      assertSnowflake(input.threadId, "threadId");

      return prisma.$transaction(async (tx) => {
        const publication = await loadPublicationByFolder(tx, input.folderId);
        if (publication === null) {
          throw new PublicationPersistenceError(
            "inconsistent_state",
            `No FolderPublication for folder ${input.folderId}`,
          );
        }
        if (publication.mainMessageId === null) {
          throw new PublicationPersistenceError(
            "inconsistent_state",
            `Cannot record thread without mainMessageId for folder ${input.folderId}`,
          );
        }
        if (publication.status !== "main_published") {
          assertTransition(publication.status, "main_published");
        }

        const updated = (await tx.folderPublication.update({
          where: { id: publication.id },
          data: {
            status: "main_published",
            threadId: input.threadId,
            lastErrorCode: null,
            lastActivityAt: new Date(),
          },
        })) as FolderPublicationRow;

        let attempt: PublicationAttemptRow | null = null;
        if (
          input.attemptId !== undefined ||
          input.idempotencyKey !== undefined
        ) {
          const current = await resolveAttempt(tx, {
            folderId: input.folderId,
            attemptId: input.attemptId,
            idempotencyKey: input.idempotencyKey,
          });
          if (current.status === "reserved") {
            attempt = (await tx.publicationAttempt.update({
              where: { id: current.id },
              data: {
                status: "succeeded",
                discordThreadId: input.threadId,
                errorCode: null,
                retryable: false,
                nextAttemptAt: null,
                durationMs: input.durationMs ?? null,
                attemptedAt: new Date(),
              },
            })) as PublicationAttemptRow;
          } else {
            attempt = current;
          }
        }

        return {
          publication: mapPublication(updated),
          attempt: attempt === null ? null : mapAttempt(attempt),
        };
      });
    },

    async recordEnrichmentPublished(input) {
      assertNonEmpty(input.folderId, "folderId");
      assertSnowflake(input.discordMessageId, "discordMessageId");

      return prisma.$transaction(async (tx) => {
        const publication = await loadPublicationByFolder(tx, input.folderId);
        if (publication === null) {
          throw new PublicationPersistenceError(
            "enrichment_precondition_failed",
            `No FolderPublication for folder ${input.folderId}`,
          );
        }
        if (
          !computeHasMainPublication(
            publication.status,
            publication.mainMessageId,
          )
        ) {
          throw new PublicationPersistenceError(
            "enrichment_precondition_failed",
            `Folder ${input.folderId} has no main publication for enrichment`,
          );
        }

        const updated = (await tx.folderPublication.update({
          where: { id: publication.id },
          data: { lastActivityAt: new Date(), lastErrorCode: null },
        })) as FolderPublicationRow;

        let attempt: PublicationAttemptRow | null = null;
        if (
          input.attemptId !== undefined ||
          input.idempotencyKey !== undefined
        ) {
          const current = await resolveAttempt(tx, {
            folderId: input.folderId,
            attemptId: input.attemptId,
            idempotencyKey: input.idempotencyKey,
          });
          if (current.status === "reserved") {
            attempt = (await tx.publicationAttempt.update({
              where: { id: current.id },
              data: {
                status: "succeeded",
                discordMessageId: input.discordMessageId,
                errorCode: null,
                retryable: false,
                nextAttemptAt: null,
                durationMs: input.durationMs ?? null,
                attemptedAt: new Date(),
              },
            })) as PublicationAttemptRow;
          } else {
            attempt = current;
          }
        }

        return {
          publication: mapPublication(updated),
          attempt: attempt === null ? null : mapAttempt(attempt),
        };
      });
    },

    async recordFailure(input) {
      assertNonEmpty(input.folderId, "folderId");

      return prisma.$transaction(async (tx) => {
        const publication = await loadPublicationByFolder(tx, input.folderId);
        if (publication === null) {
          throw new PublicationPersistenceError(
            "inconsistent_state",
            `No FolderPublication for folder ${input.folderId}`,
          );
        }

        const current = await resolveAttempt(tx, {
          folderId: input.folderId,
          attemptId: input.attemptId,
          idempotencyKey: input.idempotencyKey,
        });

        if (current.status !== "reserved" && current.status !== "failed") {
          throw new PublicationPersistenceError(
            "inconsistent_state",
            `Cannot record failure on attempt ${current.id} with status ${current.status}`,
          );
        }

        const attempt = (await tx.publicationAttempt.update({
          where: { id: current.id },
          data: {
            status: "failed",
            errorCode: input.errorCode,
            retryable: input.retryable,
            nextAttemptAt: input.nextAttemptAt ?? null,
            durationMs: input.durationMs ?? null,
            attemptedAt: new Date(),
          },
        })) as PublicationAttemptRow;

        const markFolderFailed = input.markFolderFailed ?? true;
        let updated = publication;

        if (
          markFolderFailed &&
          current.kind === "publish" &&
          publication.mainMessageId === null &&
          publication.status === "pending"
        ) {
          assertTransition(publication.status, "failed");
          updated = (await tx.folderPublication.update({
            where: { id: publication.id },
            data: {
              status: "failed",
              lastErrorCode: input.errorCode,
              lastActivityAt: new Date(),
            },
          })) as FolderPublicationRow;
        } else {
          updated = (await tx.folderPublication.update({
            where: { id: publication.id },
            data: {
              lastErrorCode: input.errorCode,
              lastActivityAt: new Date(),
            },
          })) as FolderPublicationRow;
        }

        return {
          publication: mapPublication(updated),
          attempt: mapAttempt(attempt),
        };
      });
    },

    async getPublicationByFolder(folderId) {
      const row = await loadPublicationByFolder(prisma, folderId);
      return row === null ? null : mapPublication(row);
    },

    async listAttemptsForFolder(folderId, options = {}) {
      const order = options.order ?? "desc";
      const rows = (await prisma.publicationAttempt.findMany({
        where: {
          folderId,
          ...(options.kind !== undefined ? { kind: options.kind } : {}),
          ...(options.status !== undefined ? { status: options.status } : {}),
        },
        orderBy: [
          { attemptedAt: order },
          { createdAt: order },
          { id: order },
        ],
      })) as PublicationAttemptRow[];
      return rows.map(mapAttempt);
    },

    async findAttemptByIdempotencyKey(idempotencyKey) {
      assertIdempotencyKey(idempotencyKey);
      const row = (await prisma.publicationAttempt.findFirst({
        where: { idempotencyKey },
        orderBy: [{ attemptNumber: "desc" }, { createdAt: "desc" }],
      })) as PublicationAttemptRow | null;
      return row === null ? null : mapAttempt(row);
    },

    async findActiveAttemptByIdempotencyKey(idempotencyKey) {
      assertIdempotencyKey(idempotencyKey);
      const row = (await prisma.publicationAttempt.findFirst({
        where: {
          idempotencyKey,
          status: { in: ["reserved", "succeeded"] },
        },
        orderBy: [{ attemptNumber: "desc" }, { createdAt: "desc" }],
      })) as PublicationAttemptRow | null;
      return row === null ? null : mapAttempt(row);
    },

    async listRetryableAttempts(options = {}) {
      const asOf = options.asOf ?? new Date();
      const take = options.take ?? 100;
      const rows = (await prisma.publicationAttempt.findMany({
        where: {
          OR: [
            { status: "reserved" },
            {
              status: "failed",
              retryable: true,
              OR: [
                { nextAttemptAt: null },
                { nextAttemptAt: { lte: asOf } },
              ],
            },
          ],
        },
        orderBy: [{ nextAttemptAt: "asc" }, { attemptedAt: "asc" }],
        take,
      })) as PublicationAttemptRow[];
      return rows.map(mapAttempt);
    },

    async listPublicationsNeedingResume(options = {}) {
      const take = options.take ?? 50;
      const rows = (await prisma.folderPublication.findMany({
        where: {
          status: "partial",
        },
        orderBy: [{ updatedAt: "asc" }],
        take,
      })) as FolderPublicationRow[];
      return rows.map(mapPublication);
    },

    async claimExecution(input) {
      assertNonEmpty(input.attemptId, "attemptId");
      assertNonEmpty(input.holderId, "holderId");
      if (!Number.isInteger(input.leaseMs) || input.leaseMs < 1) {
        throw new PublicationPersistenceError(
          "inconsistent_state",
          "leaseMs must be a positive integer",
        );
      }
      const now = input.now ?? new Date();
      const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);

      const updated = await prisma.publicationAttempt.updateMany({
        where: {
          id: input.attemptId,
          status: "reserved",
          OR: [
            { executionHolderId: null },
            { executionLeaseExpiresAt: { lte: now } },
            { executionHolderId: input.holderId },
          ],
        },
        data: {
          executionHolderId: input.holderId,
          executionLeaseExpiresAt: leaseExpiresAt,
        },
      });
      if (updated.count === 0) {
        return null;
      }
      const row = (await prisma.publicationAttempt.findUnique({
        where: { id: input.attemptId },
      })) as PublicationAttemptRow | null;
      return row === null ? null : mapAttempt(row);
    },

    async clearExecutionLease(input) {
      assertNonEmpty(input.attemptId, "attemptId");
      assertNonEmpty(input.holderId, "holderId");
      const existing = await prisma.publicationAttempt.findUnique({
        where: { id: input.attemptId },
      });
      if (existing === null) {
        return null;
      }
      if (existing.executionHolderId !== input.holderId) {
        return mapAttempt(existing as PublicationAttemptRow);
      }
      const updated = (await prisma.publicationAttempt.update({
        where: { id: input.attemptId },
        data: {
          executionHolderId: null,
          executionLeaseExpiresAt: null,
        },
      })) as PublicationAttemptRow;
      return mapAttempt(updated);
    },
  };
}
