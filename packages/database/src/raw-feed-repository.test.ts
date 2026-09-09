import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { createRawFeedRepository } from "./raw-feed-repository.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(packageRoot, "prisma", "migrations");

function createPrismaDouble() {
  const snapshots: Array<Record<string, unknown>> = [];
  const states = new Map<string, Record<string, unknown>>();

  const prisma = {
    rawFeedSnapshot: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: `snap_${snapshots.length + 1}`,
          ...data,
        };
        snapshots.push(row);
        return row;
      }),
      findMany: vi.fn(async () => [...snapshots]),
      update: vi.fn(async () => {
        throw new Error("RawFeedSnapshot must remain append-only");
      }),
    },
    collectedSourceState: {
      upsert: vi.fn(
        async ({
          where,
          create,
          update,
        }: {
          where: { sourceId: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const existing = states.get(where.sourceId);
          if (existing === undefined) {
            const created = {
              consecutiveFailures: 0,
              nextEligibleAt: null,
              ...create,
              createdAt: new Date("2026-07-16T00:00:00.000Z"),
              updatedAt: new Date("2026-07-16T00:00:00.000Z"),
            };
            states.set(where.sourceId, created);
            return created;
          }
          const next = {
            ...existing,
            ...update,
            updatedAt: new Date("2026-07-16T01:00:00.000Z"),
          };
          states.set(where.sourceId, next);
          return next;
        },
      ),
      findUnique: vi.fn(async ({ where }: { where: { sourceId: string } }) => {
        return states.get(where.sourceId) ?? null;
      }),
      findMany: vi.fn(
        async ({
          where,
          orderBy,
        }: {
          where?: {
            nextEligibleAt?: { not: null; gt: Date };
          };
          orderBy?: { sourceId?: string; nextEligibleAt?: string };
        } = {}) => {
          let list = [...states.values()];
          if (where?.nextEligibleAt !== undefined) {
            const gt = where.nextEligibleAt.gt.getTime();
            list = list.filter((row) => {
              const next = row.nextEligibleAt as Date | null | undefined;
              return next != null && next.getTime() > gt;
            });
          }
          if (orderBy?.sourceId === "asc") {
            list.sort((a, b) =>
              String(a.sourceId).localeCompare(String(b.sourceId)),
            );
          }
          if (orderBy?.nextEligibleAt === "asc") {
            list.sort(
              (a, b) =>
                ((a.nextEligibleAt as Date | null)?.getTime() ?? 0) -
                ((b.nextEligibleAt as Date | null)?.getTime() ?? 0),
            );
          }
          return list;
        },
      ),
    },
  };

  return { prisma, snapshots, states };
}

describe("Prisma migration 004.1F", () => {
  it("ships a PostgreSQL migration for CollectedSourceState and RawFeedSnapshot", () => {
    expect(existsSync(join(migrationsDir, "migration_lock.toml"))).toBe(true);

    const lock = readFileSync(
      join(migrationsDir, "migration_lock.toml"),
      "utf8",
    );
    expect(lock).toContain('provider = "postgresql"');

    const entries = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(entries.some((name) => name.includes("raw_feed_persistence"))).toBe(
      true,
    );

    const migrationName = entries.find((name) =>
      name.includes("raw_feed_persistence"),
    );
    expect(migrationName).toBeDefined();

    const sql = readFileSync(
      join(migrationsDir, migrationName!, "migration.sql"),
      "utf8",
    );

    expect(sql).toContain('CREATE TABLE "CollectedSourceState"');
    expect(sql).toContain('CREATE TABLE "RawFeedSnapshot"');
    expect(sql).toContain('"sourceId" TEXT NOT NULL');
    expect(sql).toContain('"etag" TEXT');
    expect(sql).toContain('"lastModified" TEXT');
    expect(sql).toContain('"rawBody" TEXT NOT NULL');
    expect(sql).toContain('"parseSucceeded" BOOLEAN NOT NULL');
    expect(sql).toContain('"errorMessage" TEXT');
    expect(sql).toContain(
      'CREATE INDEX "RawFeedSnapshot_sourceId_collectedAt_idx"',
    );
  });
});

describe("createRawFeedRepository", () => {
  it("inserts a RawFeedSnapshot with raw body and validators", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createRawFeedRepository(prisma as never);

    const collectedAt = new Date("2026-07-16T02:10:00.000Z");
    const saved = await repo.saveRawFeedSnapshot({
      sourceId: "openai-blog",
      collectedAt,
      httpStatus: 200,
      etag: '"abc123"',
      lastModified: "Wed, 15 Jul 2026 10:00:00 GMT",
      finalUrl: "https://example.com/feed.xml",
      feedFormat: "rss",
      rawBody: "<rss><channel></channel></rss>",
      parseSucceeded: true,
      errorMessage: null,
    });

    expect(prisma.rawFeedSnapshot.create).toHaveBeenCalledOnce();
    expect(saved.sourceId).toBe("openai-blog");
    expect(saved.rawBody).toBe("<rss><channel></channel></rss>");
    expect(saved.etag).toBe('"abc123"');
    expect(saved.lastModified).toBe("Wed, 15 Jul 2026 10:00:00 GMT");
    expect(saved.parseSucceeded).toBe(true);
    expect(saved.errorMessage).toBeNull();
  });

  it("keeps RawFeedSnapshot append-only (multiple inserts, never update)", async () => {
    const { prisma, snapshots } = createPrismaDouble();
    const repo = createRawFeedRepository(prisma as never);

    await repo.saveRawFeedSnapshot({
      sourceId: "src-a",
      collectedAt: new Date("2026-07-16T02:00:00.000Z"),
      httpStatus: 200,
      rawBody: "body-1",
      parseSucceeded: true,
    });
    await repo.saveRawFeedSnapshot({
      sourceId: "src-a",
      collectedAt: new Date("2026-07-16T02:05:00.000Z"),
      httpStatus: 200,
      rawBody: "body-2",
      parseSucceeded: true,
    });

    expect(snapshots).toHaveLength(2);
    expect(snapshots.map((row) => row.rawBody)).toEqual(["body-1", "body-2"]);
    expect(prisma.rawFeedSnapshot.create).toHaveBeenCalledTimes(2);
    expect(prisma.rawFeedSnapshot.update).not.toHaveBeenCalled();
  });

  it("creates and updates CollectedSourceState for the same sourceId", async () => {
    const { prisma, states } = createPrismaDouble();
    const repo = createRawFeedRepository(prisma as never);

    const created = await repo.saveCollectedSourceState({
      sourceId: "src-b",
      etag: '"v1"',
      lastModified: "Mon, 13 Jul 2026 08:00:00 GMT",
      lastCollectedAt: new Date("2026-07-16T02:00:00.000Z"),
      lastSuccessfulAt: new Date("2026-07-16T02:00:00.000Z"),
      lastHttpStatus: 200,
    });

    expect(created.sourceId).toBe("src-b");
    expect(created.etag).toBe('"v1"');
    expect(states.size).toBe(1);

    const updated = await repo.saveCollectedSourceState({
      sourceId: "src-b",
      etag: '"v2"',
      lastModified: "Tue, 14 Jul 2026 09:00:00 GMT",
      lastCollectedAt: new Date("2026-07-16T02:10:00.000Z"),
      lastSuccessfulAt: new Date("2026-07-16T02:10:00.000Z"),
      lastHttpStatus: 304,
    });

    expect(prisma.collectedSourceState.upsert).toHaveBeenCalledTimes(2);
    expect(updated.etag).toBe('"v2"');
    expect(updated.lastModified).toBe("Tue, 14 Jul 2026 09:00:00 GMT");
    expect(updated.lastHttpStatus).toBe(304);
    expect(states.size).toBe(1);
  });

  it("persists ETag on both snapshot and source state", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createRawFeedRepository(prisma as never);
    const etag = '"feed-etag-42"';

    const snapshot = await repo.saveRawFeedSnapshot({
      sourceId: "src-etag",
      collectedAt: new Date("2026-07-16T02:10:00.000Z"),
      httpStatus: 200,
      etag,
      rawBody: "<feed/>",
      parseSucceeded: true,
    });
    const state = await repo.saveCollectedSourceState({
      sourceId: "src-etag",
      etag,
      lastCollectedAt: new Date("2026-07-16T02:10:00.000Z"),
      lastSuccessfulAt: new Date("2026-07-16T02:10:00.000Z"),
      lastHttpStatus: 200,
    });

    expect(snapshot.etag).toBe(etag);
    expect(state.etag).toBe(etag);
  });

  it("persists Last-Modified on both snapshot and source state", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createRawFeedRepository(prisma as never);
    const lastModified = "Wed, 15 Jul 2026 12:34:56 GMT";

    const snapshot = await repo.saveRawFeedSnapshot({
      sourceId: "src-lm",
      collectedAt: new Date("2026-07-16T02:10:00.000Z"),
      httpStatus: 200,
      lastModified,
      rawBody: "<feed/>",
      parseSucceeded: true,
    });
    const state = await repo.saveCollectedSourceState({
      sourceId: "src-lm",
      lastModified,
      lastCollectedAt: new Date("2026-07-16T02:10:00.000Z"),
      lastSuccessfulAt: new Date("2026-07-16T02:10:00.000Z"),
      lastHttpStatus: 200,
    });

    expect(snapshot.lastModified).toBe(lastModified);
    expect(state.lastModified).toBe(lastModified);
  });

  it("records a collection error with parseSucceeded false and errorMessage", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createRawFeedRepository(prisma as never);

    const saved = await repo.saveRawFeedSnapshot({
      sourceId: "src-err",
      collectedAt: new Date("2026-07-16T02:10:00.000Z"),
      httpStatus: 200,
      finalUrl: "https://example.com/broken.xml",
      feedFormat: null,
      rawBody: "<not-valid",
      parseSucceeded: false,
      errorMessage: "Invalid XML: unexpected end of input",
    });

    const state = await repo.saveCollectedSourceState({
      sourceId: "src-err",
      lastCollectedAt: new Date("2026-07-16T02:10:00.000Z"),
      lastSuccessfulAt: null,
      lastHttpStatus: 200,
    });

    expect(saved.parseSucceeded).toBe(false);
    expect(saved.errorMessage).toBe("Invalid XML: unexpected end of input");
    expect(saved.feedFormat).toBeNull();
    expect(state.lastSuccessfulAt).toBeNull();
    expect(state.lastHttpStatus).toBe(200);
  });

  it("supports parseSucceeded true without errorMessage", async () => {
    const { prisma } = createPrismaDouble();
    const repo = createRawFeedRepository(prisma as never);

    const saved = await repo.saveRawFeedSnapshot({
      sourceId: "src-ok",
      collectedAt: new Date("2026-07-16T02:10:00.000Z"),
      httpStatus: 200,
      feedFormat: "atom",
      rawBody: '<feed xmlns="http://www.w3.org/2005/Atom"></feed>',
      parseSucceeded: true,
    });

    expect(saved.parseSucceeded).toBe(true);
    expect(saved.errorMessage).toBeNull();
    expect(saved.feedFormat).toBe("atom");
  });

  it("records and clears source backoff without wiping incremental state", async () => {
    const { prisma, states } = createPrismaDouble();
    const repo = createRawFeedRepository(prisma as never);

    await repo.saveCollectedSourceState({
      sourceId: "src-backoff",
      etag: '"v1"',
      lastSuccessfulAt: new Date("2026-07-16T01:00:00.000Z"),
      lastHttpStatus: 200,
    });

    const nextEligibleAt = new Date("2026-07-16T03:00:00.000Z");
    const backedOff = await repo.recordSourceBackoff({
      sourceId: "src-backoff",
      consecutiveFailures: 2,
      nextEligibleAt,
      lastHttpStatus: 503,
    });

    expect(backedOff.consecutiveFailures).toBe(2);
    expect(backedOff.nextEligibleAt).toEqual(nextEligibleAt);
    expect(backedOff.etag).toBe('"v1"');
    expect(backedOff.lastHttpStatus).toBe(503);

    // Updating collection state without backoff fields preserves them.
    const afterCollect = await repo.saveCollectedSourceState({
      sourceId: "src-backoff",
      etag: '"v2"',
      lastCollectedAt: new Date("2026-07-16T02:30:00.000Z"),
      lastHttpStatus: 503,
    });
    expect(afterCollect.consecutiveFailures).toBe(2);
    expect(afterCollect.nextEligibleAt).toEqual(nextEligibleAt);
    expect(afterCollect.etag).toBe('"v2"');

    const inBackoff = await repo.listSourcesInBackoff(
      new Date("2026-07-16T02:45:00.000Z"),
    );
    expect(inBackoff.map((s) => s.sourceId)).toEqual(["src-backoff"]);

    const cleared = await repo.clearSourceBackoff("src-backoff");
    expect(cleared.consecutiveFailures).toBe(0);
    expect(cleared.nextEligibleAt).toBeNull();
    expect(states.get("src-backoff")?.etag).toBe('"v2"');
  });
});
