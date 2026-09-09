import { Prisma, type PrismaClient } from "@prisma/client";

import { AdministrationPersistenceError } from "./administration-types.js";

/** Singleton id for the cross-process Ollama inference lock (010.1A AUD-003). */
export const INFERENCE_LOCK_ID = "ollama" as const;

export type InferenceLockRecord = {
  readonly id: string;
  readonly holderId: string | null;
  readonly acquiredAt: Date | null;
  readonly expiresAt: Date | null;
  readonly heartbeatAt: Date | null;
};

export type AcquireInferenceLockInput = {
  readonly holderId: string;
  readonly expiresAt: Date;
  readonly now?: Date;
};

export type AcquireInferenceLockOutcome =
  | {
      readonly kind: "acquired";
      readonly lock: InferenceLockRecord;
      readonly stolen: boolean;
    }
  | {
      readonly kind: "blocked";
      readonly lock: InferenceLockRecord;
    };

type InferenceLockRow = {
  id: string;
  holderId: string | null;
  acquiredAt: Date | null;
  expiresAt: Date | null;
  heartbeatAt: Date | null;
};

function mapLock(row: InferenceLockRow): InferenceLockRecord {
  return {
    id: row.id,
    holderId: row.holderId,
    acquiredAt: row.acquiredAt,
    expiresAt: row.expiresAt,
    heartbeatAt: row.heartbeatAt,
  };
}

function isHeld(lock: InferenceLockRow): boolean {
  return lock.holderId !== null;
}

function isExpired(lock: InferenceLockRow, now: Date): boolean {
  if (!isHeld(lock)) {
    return false;
  }
  if (lock.expiresAt === null) {
    return true;
  }
  return lock.expiresAt.getTime() <= now.getTime();
}

export interface InferenceLockRepository {
  tryAcquire(
    input: AcquireInferenceLockInput,
  ): Promise<AcquireInferenceLockOutcome>;
  release(input: {
    holderId: string;
    now?: Date;
  }): Promise<InferenceLockRecord>;
  getLock(): Promise<InferenceLockRecord>;
}

/**
 * Cross-process single-flight lock for Ollama inference (AUD-003).
 */
export function createInferenceLockRepository(
  prisma: PrismaClient,
): InferenceLockRepository {
  return {
    async getLock() {
      const row = await prisma.inferenceLock.findUnique({
        where: { id: INFERENCE_LOCK_ID },
      });
      if (row === null) {
        throw new AdministrationPersistenceError(
          "invalid_input",
          `InferenceLock singleton "${INFERENCE_LOCK_ID}" is missing — run migrations`,
        );
      }
      return mapLock(row);
    },

    async tryAcquire(input) {
      if (typeof input.holderId !== "string" || input.holderId.trim() === "") {
        throw new AdministrationPersistenceError(
          "invalid_input",
          "holderId must be a non-empty string",
        );
      }
      const now = input.now ?? new Date();

      return prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<InferenceLockRow[]>(
          Prisma.sql`SELECT "id", "holderId", "acquiredAt", "expiresAt", "heartbeatAt"
            FROM "InferenceLock" WHERE "id" = ${INFERENCE_LOCK_ID} FOR UPDATE`,
        );
        const lock = rows[0];
        if (lock === undefined) {
          throw new AdministrationPersistenceError(
            "invalid_input",
            `InferenceLock singleton "${INFERENCE_LOCK_ID}" is missing — run migrations`,
          );
        }

        let stolen = false;
        if (isHeld(lock) && !isExpired(lock, now)) {
          return { kind: "blocked" as const, lock: mapLock(lock) };
        }
        if (isHeld(lock) && isExpired(lock, now)) {
          stolen = true;
        }

        const next = await tx.inferenceLock.update({
          where: { id: INFERENCE_LOCK_ID },
          data: {
            holderId: input.holderId,
            acquiredAt: now,
            heartbeatAt: now,
            expiresAt: input.expiresAt,
          },
        });
        return {
          kind: "acquired" as const,
          lock: mapLock(next),
          stolen,
        };
      });
    },

    async release(input) {
      if (typeof input.holderId !== "string" || input.holderId.trim() === "") {
        throw new AdministrationPersistenceError(
          "invalid_input",
          "holderId must be a non-empty string",
        );
      }
      const now = input.now ?? new Date();

      return prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<InferenceLockRow[]>(
          Prisma.sql`SELECT "id", "holderId", "acquiredAt", "expiresAt", "heartbeatAt"
            FROM "InferenceLock" WHERE "id" = ${INFERENCE_LOCK_ID} FOR UPDATE`,
        );
        const lock = rows[0];
        if (lock === undefined || !isHeld(lock)) {
          throw new AdministrationPersistenceError(
            "lock_not_held",
            "Cannot release: inference lock is not held",
          );
        }
        if (lock.holderId !== input.holderId) {
          throw new AdministrationPersistenceError(
            "lock_holder_mismatch",
            `Cannot release: holder mismatch (expected ${String(lock.holderId)})`,
          );
        }
        const next = await tx.inferenceLock.update({
          where: { id: INFERENCE_LOCK_ID },
          data: {
            holderId: null,
            acquiredAt: null,
            expiresAt: null,
            heartbeatAt: now,
          },
        });
        return mapLock(next);
      });
    },
  };
}
