/**
 * 008.1F — Intégration finale pipeline Publication Discord
 * Chaîne : décision 007 → orchestrateur 008.1D → port Discord → persistance 008.1B
 * Mocks uniquement (Prisma double + port Discord) ; builders 008.1C réels.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  DiscordPublicationPortError,
  PUBLICATION_THREAD_AUTO_ARCHIVE_MINUTES,
} from "./publication-orchestration-types.js";
import {
  ANALYSIS_ID,
  CHANNEL_ID,
  FINGERPRINT,
  FOLDER_ID,
  createPipeline,
  createPrismaDouble,
  enrichInput,
  publishInput,
} from "./publication-integration-harness.js";
import {
  buildEnrichIdempotencyKey,
  buildPublishIdempotencyKey,
} from "./publication-types.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = join(packageRoot, "..", "..");

describe("008.1F publication pipeline integration", () => {
  it("publish complet: reserve → build → Discord → persist IDs", async () => {
    const { orchestrator, discord, repository, prisma } = createPipeline();

    const result = await orchestrator.process(publishInput());

    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded") return;

    expect(result.mainMessageId).toBe("msg_main_1");
    expect(result.threadId).toBe("thr_1");
    expect(result.publication.status).toBe("main_published");
    expect(result.publication.hasMainPublication).toBe(true);
    expect(result.publication.channelId).toBe(CHANNEL_ID);
    expect(result.channelRole).toBe("VEILLE_PERTINENTE");

    expect(discord.calls.sendMainMessage).toBe(1);
    expect(discord.calls.startThread).toBe(1);
    expect(discord.sendMainMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: CHANNEL_ID,
        content: expect.objectContaining({
          content: expect.any(String),
          embeds: expect.any(Array),
        }),
      }),
    );
    expect(discord.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        autoArchiveMinutes: PUBLICATION_THREAD_AUTO_ARCHIVE_MINUTES,
      }),
    );

    const stored = await repository.getPublicationByFolder(FOLDER_ID);
    expect(stored?.mainMessageId).toBe("msg_main_1");
    expect(stored?.threadId).toBe("thr_1");
    expect(prisma.__publications).toHaveLength(1);
    expect(
      prisma.__attempts.filter((a) => a.status === "succeeded").length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("enrichissement complet: unarchive → thread message → persist", async () => {
    const { orchestrator, discord, repository } = createPipeline();
    await orchestrator.process(publishInput());
    discord.calls.sendMainMessage = 0;
    discord.calls.startThread = 0;
    discord.calls.sendThreadMessage = 0;
    discord.calls.unarchiveThreadIfNeeded = 0;

    const result = await orchestrator.process(enrichInput());

    expect(result.kind).toBe("enriched");
    if (result.kind !== "enriched") return;
    expect(result.threadMessageId).toBe("msg_thr_1");
    expect(discord.calls.unarchiveThreadIfNeeded).toBe(1);
    expect(discord.calls.sendThreadMessage).toBe(1);
    expect(discord.calls.sendMainMessage).toBe(0);
    expect(discord.calls.startThread).toBe(0);

    const attempts = await repository.listAttemptsForFolder(FOLDER_ID, {
      kind: "enrich",
    });
    expect(attempts.some((a) => a.status === "succeeded")).toBe(true);
  });

  it("hold: zéro Discord, zéro mutation FolderPublication", async () => {
    const { orchestrator, discord, prisma } = createPipeline();

    const result = await orchestrator.process({
      folderId: FOLDER_ID,
      decision: "hold",
      analysisAttemptId: null,
      channelHint: null,
      aggregateFingerprint: null,
    });

    expect(result).toMatchObject({
      kind: "skipped",
      reason: "hold",
      errorCode: "hold",
    });
    expect(discord.calls.sendMainMessage).toBe(0);
    expect(discord.calls.startThread).toBe(0);
    expect(discord.calls.sendThreadMessage).toBe(0);
    expect(prisma.__publications).toHaveLength(0);
    expect(prisma.__attempts).toHaveLength(0);
  });

  it("reject_editorial: zéro Discord, skip déterministe", async () => {
    const { orchestrator, discord, prisma } = createPipeline();

    const result = await orchestrator.process({
      folderId: FOLDER_ID,
      decision: "reject_editorial",
      analysisAttemptId: null,
      channelHint: null,
      aggregateFingerprint: null,
    });

    expect(result).toMatchObject({
      kind: "skipped",
      reason: "reject_editorial",
      errorCode: "reject_editorial",
    });
    expect(discord.calls.sendMainMessage).toBe(0);
    expect(prisma.__publications).toHaveLength(0);
  });

  it("succès partiel: message OK, startThread KO → partial récupérable", async () => {
    const { orchestrator, discord, repository } = createPipeline({
      discord: {
        startThread: vi.fn(async () => {
          throw new DiscordPublicationPortError(
            "missing_permission",
            "cannot create thread",
            { retryable: false },
          );
        }),
      },
    });

    const result = await orchestrator.process(publishInput());

    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") return;
    expect(result.mainMessageId).toBe("msg_main_1");
    expect(result.pending).toBe("thread");
    expect(result.errorCode).toBe("missing_permission");

    const stored = await repository.getPublicationByFolder(FOLDER_ID);
    expect(stored?.status).toBe("partial");
    expect(stored?.mainMessageId).toBe("msg_main_1");
    expect(stored?.threadId).toBeNull();
    expect(stored?.hasMainPublication).toBe(true);
    expect(discord.calls.sendMainMessage).toBe(1);
  });

  it("reprise via resume(): partial → create_thread → succeeded", async () => {
    const { orchestrator, discord, repository } = createPipeline({
      discord: {
        startThread: vi
          .fn()
          .mockRejectedValueOnce(
            new DiscordPublicationPortError(
              "discord_timeout",
              "timeout",
              { retryable: true },
            ),
          )
          .mockResolvedValueOnce({ threadId: "thr_resumed" }),
      },
    });

    const partial = await orchestrator.process(publishInput());
    expect(partial.kind).toBe("partial");

    const resumed = await orchestrator.resume(FOLDER_ID);

    expect(resumed.kind).toBe("succeeded");
    if (resumed.kind !== "succeeded") return;
    expect(resumed.threadId).toBe("thr_resumed");
    expect(resumed.mainMessageId).toBe("msg_main_1");
    expect(discord.sendMainMessage).toHaveBeenCalledTimes(1);

    const stored = await repository.getPublicationByFolder(FOLDER_ID);
    expect(stored?.status).toBe("main_published");
    expect(stored?.threadId).toBe("thr_resumed");
  });

  it("publication déjà existante: second publish → idempotent_hit, pas de Discord", async () => {
    const { orchestrator, discord } = createPipeline();
    const first = await orchestrator.process(publishInput());
    expect(first.kind).toBe("succeeded");

    const second = await orchestrator.process(publishInput());

    expect(second.kind).toBe("skipped");
    if (second.kind !== "skipped") return;
    expect(second.reason).toBe("idempotent_hit");
    expect(discord.calls.sendMainMessage).toBe(1);
    expect(discord.calls.startThread).toBe(1);
  });

  it("enrichissement idempotent: même clé → pas de second message fil", async () => {
    const { orchestrator, discord, repository } = createPipeline();
    await orchestrator.process(publishInput());
    const first = await orchestrator.process(enrichInput());
    expect(first.kind).toBe("enriched");

    const second = await orchestrator.process(enrichInput());

    expect(second.kind).toBe("skipped");
    if (second.kind !== "skipped") return;
    expect(second.reason).toBe("idempotent_hit");
    expect(discord.calls.sendThreadMessage).toBe(1);

    const key = buildEnrichIdempotencyKey(
      FOLDER_ID,
      FINGERPRINT,
      ANALYSIS_ID,
    );
    const attempt = await repository.findAttemptByIdempotencyKey(key);
    expect(attempt?.status).toBe("succeeded");
  });

  it("dossier closed: skip folder_closed, zéro Discord", async () => {
    const prisma = createPrismaDouble([
      {
        id: FOLDER_ID,
        status: "closed",
        title: "Closed folder",
      },
    ]);
    const { orchestrator, discord } = createPipeline({ prisma });

    const result = await orchestrator.process(publishInput());

    expect(result.kind).toBe("skipped");
    if (result.kind !== "skipped") return;
    expect(result.reason).toBe("folder_closed");
    expect(discord.calls.sendMainMessage).toBe(0);
    expect(prisma.__publications).toHaveLength(0);
  });

  it("erreur retryable: discord_unavailable → failed retryable", async () => {
    const { orchestrator, repository } = createPipeline({
      discord: {
        sendMainMessage: vi.fn(async () => {
          throw new DiscordPublicationPortError(
            "discord_unavailable",
            "gateway down",
          );
        }),
      },
    });

    const result = await orchestrator.process(publishInput());

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.error).toBe("discord_unavailable");
    expect(result.retryable).toBe(true);

    const stored = await repository.getPublicationByFolder(FOLDER_ID);
    expect(stored?.status).toBe("failed");
    expect(stored?.lastErrorCode).toBe("discord_unavailable");
  });

  it("erreur terminale: missing_permission → failed non-retryable", async () => {
    const { orchestrator, repository } = createPipeline({
      discord: {
        sendMainMessage: vi.fn(async () => {
          throw new DiscordPublicationPortError(
            "missing_permission",
            "no send",
            { retryable: false },
          );
        }),
      },
    });

    const result = await orchestrator.process(publishInput());

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.error).toBe("missing_permission");
    expect(result.retryable).toBe(false);

    const stored = await repository.getPublicationByFolder(FOLDER_ID);
    expect(stored?.status).toBe("failed");
  });

  it("salon absent / unmapped: channel_unmapped, zéro Discord", async () => {
    const { orchestrator, discord } = createPipeline({
      resolveChannelId: () => null,
    });

    const result = await orchestrator.process(publishInput());

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.error).toBe("channel_unmapped");
    expect(discord.calls.sendMainMessage).toBe(0);
  });

  it("thread archivé: unarchiveThreadIfNeeded appelé avant enrich", async () => {
    const unarchive = vi.fn(async () => undefined);
    const { orchestrator } = createPipeline({
      discord: { unarchiveThreadIfNeeded: unarchive },
    });
    await orchestrator.process(publishInput());

    await orchestrator.process(enrichInput());

    expect(unarchive).toHaveBeenCalledWith({ threadId: "thr_1" });
  });

  it("thread verrouillé: unarchive inconsistent_state → failed", async () => {
    const { orchestrator, discord } = createPipeline({
      discord: {
        unarchiveThreadIfNeeded: vi.fn(async () => {
          throw new DiscordPublicationPortError(
            "inconsistent_state",
            "thread locked",
            { retryable: false },
          );
        }),
      },
    });
    await orchestrator.process(publishInput());

    const result = await orchestrator.process(enrichInput());

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.error).toBe("inconsistent_state");
    expect(result.retryable).toBe(false);
    expect(discord.calls.sendThreadMessage).toBe(0);
  });

  it("perte d'IDs / état inconsistent: enrich refuse sans recreate (P20)", async () => {
    const pipeline = createPipeline();
    await pipeline.orchestrator.process(publishInput());

    // Simulate known Discord ID loss marked inconsistent (gel §10.3 / P20)
    const row = pipeline.prisma.__publications[0]!;
    row.status = "inconsistent";
    row.threadId = null;

    const result = await pipeline.orchestrator.process(enrichInput());

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.error).toBe("inconsistent_state");
    expect(pipeline.discord.calls.sendThreadMessage).toBe(0);
    // No automatic recreate of main publication
    expect(pipeline.discord.calls.sendMainMessage).toBe(1);
  });

  it("reprise après redémarrage: nouvel orchestrateur + même store → resume", async () => {
    const prisma = createPrismaDouble();
    const first = createPipeline({
      prisma,
      discord: {
        startThread: vi.fn(async () => {
          throw new DiscordPublicationPortError(
            "discord_unavailable",
            "down",
          );
        }),
      },
    });

    const partial = await first.orchestrator.process(publishInput());
    expect(partial.kind).toBe("partial");

    // Simulate process restart: new orchestrator, same persistence
    const restarted = createPipeline({ prisma });
    const resumed = await restarted.orchestrator.resume(FOLDER_ID);

    expect(resumed.kind).toBe("succeeded");
    if (resumed.kind !== "succeeded") return;
    expect(resumed.mainMessageId).toBe("msg_main_1");
    expect(resumed.threadId).toBe("thr_1");
    expect(restarted.discord.calls.sendMainMessage).toBe(0);
    expect(restarted.discord.calls.startThread).toBe(1);

    const stored = await restarted.repository.getPublicationByFolder(FOLDER_ID);
    expect(stored?.status).toBe("main_published");
  });

  it("cohérence repository ↔ orchestrateur ↔ port (ordre + snowflakes)", async () => {
    const order: string[] = [];
    const { orchestrator, repository } = createPipeline({
      discord: {
        sendMainMessage: vi.fn(async () => {
          order.push("discord:sendMain");
          return { messageId: "msg_order_1" };
        }),
        startThread: vi.fn(async () => {
          order.push("discord:startThread");
          return { threadId: "thr_order_1" };
        }),
      },
    });

    const originalReserve = repository.reservePublish.bind(repository);
    repository.reservePublish = vi.fn(async (input) => {
      order.push("repo:reserve");
      return originalReserve(input);
    });
    const originalMain = repository.recordMainPublicationSuccess.bind(repository);
    repository.recordMainPublicationSuccess = vi.fn(async (input) => {
      order.push("repo:recordMain");
      return originalMain(input);
    });
    const originalThread = repository.recordThreadCreated.bind(repository);
    repository.recordThreadCreated = vi.fn(async (input) => {
      order.push("repo:recordThread");
      return originalThread(input);
    });

    const result = await orchestrator.process(publishInput());
    expect(result.kind).toBe("succeeded");

    expect(order.indexOf("repo:reserve")).toBeLessThan(
      order.indexOf("discord:sendMain"),
    );
    expect(order.indexOf("discord:sendMain")).toBeLessThan(
      order.indexOf("repo:recordMain"),
    );
    expect(order.indexOf("repo:recordMain")).toBeLessThan(
      order.indexOf("discord:startThread"),
    );
    expect(order.indexOf("discord:startThread")).toBeLessThan(
      order.indexOf("repo:recordThread"),
    );

    const stored = await repository.getPublicationByFolder(FOLDER_ID);
    expect(stored).toMatchObject({
      mainMessageId: "msg_order_1",
      threadId: "thr_order_1",
      status: "main_published",
      hasMainPublication: true,
    });
  });

  it("absence de duplication: double process + double resume n'ajoutent pas de message", async () => {
    const { orchestrator, discord, repository } = createPipeline();

    await orchestrator.process(publishInput());
    await orchestrator.process(publishInput());
    await orchestrator.resume(FOLDER_ID);
    await orchestrator.resume(FOLDER_ID);

    expect(discord.calls.sendMainMessage).toBe(1);
    expect(discord.calls.startThread).toBe(1);

    const publishAttempts = await repository.listAttemptsForFolder(FOLDER_ID, {
      kind: "publish",
    });
    const succeededPublish = publishAttempts.filter(
      (a) => a.status === "succeeded",
    );
    expect(succeededPublish).toHaveLength(1);
    expect(succeededPublish[0]?.idempotencyKey).toBe(
      buildPublishIdempotencyKey(FOLDER_ID),
    );

    const pubs = (
      await repository.listPublicationsNeedingResume()
    ).filter((p) => p.folderId === FOLDER_ID);
    // Fully published → not needing resume (only `partial` is listed)
    const current = await repository.getPublicationByFolder(FOLDER_ID);
    expect(current?.status).toBe("main_published");
    expect(pubs).toHaveLength(0);
  });
});

describe("008.1F architecture boundaries", () => {
  it("aucune dépendance discord.js hors apps/bot", () => {
    for (const pkg of ["database", "shared", "analysis", "config", "collector", "api"]) {
      const pkgJson = JSON.parse(
        readFileSync(join(workspaceRoot, pkg === "api" ? "apps" : "packages", pkg === "api" ? "api" : pkg, "package.json"), "utf8"),
      ) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = {
        ...pkgJson.dependencies,
        ...pkgJson.devDependencies,
      };
      expect(deps["discord.js"], `${pkg} must not depend on discord.js`).toBeUndefined();
    }
  });

  it("aucune dépendance Prisma hors @radar-ia/database", () => {
    for (const pkg of ["shared", "analysis", "config", "collector", "bot", "api"]) {
      const base = pkg === "bot" || pkg === "api" ? "apps" : "packages";
      const pkgJson = JSON.parse(
        readFileSync(join(workspaceRoot, base, pkg, "package.json"), "utf8"),
      ) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = {
        ...pkgJson.dependencies,
        ...pkgJson.devDependencies,
      };
      expect(deps["@prisma/client"], `${pkg} must not depend on @prisma/client`).toBeUndefined();
      expect(deps.prisma, `${pkg} must not depend on prisma`).toBeUndefined();
    }
  });

  it("séparation database/shared/bot: bot dépend de database, database ne dépend pas de bot", () => {
    const botPkg = JSON.parse(
      readFileSync(join(workspaceRoot, "apps", "bot", "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    const dbPkg = JSON.parse(
      readFileSync(join(workspaceRoot, "packages", "database", "package.json"), "utf8"),
    ) as { dependencies: Record<string, string> };
    const sharedPkg = JSON.parse(
      readFileSync(join(workspaceRoot, "packages", "shared", "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };

    expect(botPkg.dependencies["@radar-ia/database"]).toBeDefined();
    expect(botPkg.dependencies["discord.js"]).toBeDefined();
    expect(dbPkg.dependencies["@radar-ia/bot"]).toBeUndefined();
    expect(dbPkg.dependencies["discord.js"]).toBeUndefined();
    expect(sharedPkg.dependencies?.["@radar-ia/database"]).toBeUndefined();
    expect(sharedPkg.dependencies?.["discord.js"]).toBeUndefined();
  });

  it("aucune logique métier Discord dans le port interface (database)", () => {
    const orchestratorSrc = readFileSync(
      join(packageRoot, "src", "publication-orchestrator.ts"),
      "utf8",
    );
    expect(orchestratorSrc).not.toMatch(/from ["']discord\.js["']/);
    expect(orchestratorSrc).toContain("DiscordPublicationPort");
    expect(orchestratorSrc).toContain("hold");
    expect(orchestratorSrc).toContain("reject_editorial");
  });
});
