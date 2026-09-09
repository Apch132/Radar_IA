import { Prisma, type PrismaClient } from "@prisma/client";

import type {
  CollectedSourceState,
  RawFeedSnapshot,
  RecordSourceBackoffInput,
  SaveCollectedSourceStateInput,
  SaveRawFeedSnapshotInput,
} from "./raw-feed-types.js";

export interface RawFeedRepository {
  /** Append-only insert of a raw collection snapshot. */
  saveRawFeedSnapshot(input: SaveRawFeedSnapshotInput): Promise<RawFeedSnapshot>;
  /** Upsert incremental collection state for one source. */
  saveCollectedSourceState(
    input: SaveCollectedSourceStateInput,
  ): Promise<CollectedSourceState>;
  /** Read one source runtime / incremental state, or null. */
  getCollectedSourceState(
    sourceId: string,
  ): Promise<CollectedSourceState | null>;
  /** List all source runtime states (ordered by sourceId). */
  listCollectedSourceStates(): Promise<CollectedSourceState[]>;
  /**
   * Sources currently in backoff (`nextEligibleAt` not null and `> now`).
   * Default `now` = `new Date()`.
   */
  listSourcesInBackoff(now?: Date): Promise<CollectedSourceState[]>;
  /**
   * Apply / refresh backoff after a collection failure.
   * Creates the row if missing (preserves null incremental fields).
   */
  recordSourceBackoff(
    input: RecordSourceBackoffInput,
  ): Promise<CollectedSourceState>;
  /**
   * Clear backoff (admin force or auto recovery after success).
   * Resets `consecutiveFailures` to 0 and `nextEligibleAt` to null.
   */
  clearSourceBackoff(sourceId: string): Promise<CollectedSourceState>;
  /** Remove snapshots outside the configured per-source and age retention. */
  purgeOldSnapshots?(input: {
    keepPerSource: number;
    olderThan?: Date;
  }): Promise<number>;
}

/**
 * Factory for the raw feed persistence repository.
 * Prisma client is injected for testability.
 */
export function createRawFeedRepository(
  prisma: PrismaClient,
): RawFeedRepository {
  return {
    async saveRawFeedSnapshot(input) {
      return prisma.rawFeedSnapshot.create({
        data: {
          sourceId: input.sourceId,
          collectedAt: input.collectedAt,
          httpStatus: input.httpStatus,
          etag: input.etag ?? null,
          lastModified: input.lastModified ?? null,
          finalUrl: input.finalUrl ?? null,
          feedFormat: input.feedFormat ?? null,
          rawBody: input.rawBody,
          parseSucceeded: input.parseSucceeded,
          errorMessage: input.errorMessage ?? null,
        },
      });
    },

    async saveCollectedSourceState(input) {
      const backoffCreate = {
        consecutiveFailures: input.consecutiveFailures ?? 0,
        nextEligibleAt:
          input.nextEligibleAt === undefined ? null : input.nextEligibleAt,
      };
      const backoffUpdate: {
        consecutiveFailures?: number;
        nextEligibleAt?: Date | null;
      } = {};
      if (input.consecutiveFailures !== undefined) {
        backoffUpdate.consecutiveFailures = input.consecutiveFailures;
      }
      if (input.nextEligibleAt !== undefined) {
        backoffUpdate.nextEligibleAt = input.nextEligibleAt;
      }

      return prisma.collectedSourceState.upsert({
        where: { sourceId: input.sourceId },
        create: {
          sourceId: input.sourceId,
          etag: input.etag ?? null,
          lastModified: input.lastModified ?? null,
          lastCollectedAt: input.lastCollectedAt ?? null,
          lastSuccessfulAt: input.lastSuccessfulAt ?? null,
          lastHttpStatus: input.lastHttpStatus ?? null,
          ...backoffCreate,
        },
        update: {
          etag: input.etag ?? null,
          lastModified: input.lastModified ?? null,
          lastCollectedAt: input.lastCollectedAt ?? null,
          lastSuccessfulAt: input.lastSuccessfulAt ?? null,
          lastHttpStatus: input.lastHttpStatus ?? null,
          ...backoffUpdate,
        },
      });
    },

    async getCollectedSourceState(sourceId) {
      return prisma.collectedSourceState.findUnique({
        where: { sourceId },
      });
    },

    async listCollectedSourceStates() {
      return prisma.collectedSourceState.findMany({
        orderBy: { sourceId: "asc" },
      });
    },

    async listSourcesInBackoff(now = new Date()) {
      return prisma.collectedSourceState.findMany({
        where: {
          nextEligibleAt: { not: null, gt: now },
        },
        orderBy: { nextEligibleAt: "asc" },
      });
    },

    async recordSourceBackoff(input) {
      if (
        !Number.isInteger(input.consecutiveFailures) ||
        input.consecutiveFailures < 1
      ) {
        throw new Error(
          `consecutiveFailures must be an integer >= 1; got ${String(input.consecutiveFailures)}`,
        );
      }
      return prisma.collectedSourceState.upsert({
        where: { sourceId: input.sourceId },
        create: {
          sourceId: input.sourceId,
          consecutiveFailures: input.consecutiveFailures,
          nextEligibleAt: input.nextEligibleAt,
          lastCollectedAt: input.lastCollectedAt ?? null,
          lastHttpStatus: input.lastHttpStatus ?? null,
        },
        update: {
          consecutiveFailures: input.consecutiveFailures,
          nextEligibleAt: input.nextEligibleAt,
          ...(input.lastCollectedAt !== undefined
            ? { lastCollectedAt: input.lastCollectedAt }
            : {}),
          ...(input.lastHttpStatus !== undefined
            ? { lastHttpStatus: input.lastHttpStatus }
            : {}),
        },
      });
    },

    async clearSourceBackoff(sourceId) {
      return prisma.collectedSourceState.upsert({
        where: { sourceId },
        create: {
          sourceId,
          consecutiveFailures: 0,
          nextEligibleAt: null,
        },
        update: {
          consecutiveFailures: 0,
          nextEligibleAt: null,
        },
      });
    },

    async purgeOldSnapshots(input) {
      if (!Number.isInteger(input.keepPerSource) || input.keepPerSource < 1) {
        throw new Error("keepPerSource must be an integer >= 1");
      }
      const ageClause =
        input.olderThan === undefined
          ? Prisma.empty
          : Prisma.sql` OR "collectedAt" < ${input.olderThan}`;
      const result = await prisma.$executeRaw(
        Prisma.sql`DELETE FROM "RawFeedSnapshot"
          WHERE "id" IN (
            SELECT "id" FROM (
              SELECT "id", "collectedAt",
                ROW_NUMBER() OVER (
                  PARTITION BY "sourceId"
                  ORDER BY "collectedAt" DESC, "id" DESC
                ) AS snapshot_rank
              FROM "RawFeedSnapshot"
            ) ranked
            WHERE snapshot_rank > ${input.keepPerSource}${ageClause}
          )`,
      );
      return result;
    },
  };
}
