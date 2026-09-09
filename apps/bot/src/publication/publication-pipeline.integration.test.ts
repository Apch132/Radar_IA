/**
 * 008.1F — Intégration adaptateur Discord (008.1E) + orchestrateur (008.1D).
 * Chaîne complète sans réseau Discord réel (client discord.js doublé).
 */
import { describe, expect, it, vi } from "vitest";
import { type Config } from "@radar-ia/config";
import { ChannelType } from "discord.js";
import {
  createPublicationOrchestrator,
  DiscordPublicationPortError,
  type PublicationOrchestrationInput,
  type PublicationRepository,
  type FolderPublicationRecord,
  type PublicationAttemptRecord,
  type NewsFolderRepository,
  buildPublishIdempotencyKey,
  buildCreateThreadIdempotencyKey,
  buildEnrichIdempotencyKey,
  computeHasMainPublication,
  PUBLICATION_THREAD_AUTO_ARCHIVE_MINUTES,
} from "@radar-ia/database";

import {
  createDiscordPublicationAdapter,
  createPublicationChannelResolver,
} from "./index.js";

const GUILD_ID = "123456789012345678";
const CHANNEL_ID = "111111111111111111";
const THREAD_ID = "222222222222222222";
const MESSAGE_ID = "333333333333333333";
const FOLDER_ID = "fld_bot_pipeline_1";
const ANALYSIS_ID = "att_bot_1";
const FINGERPRINT = "bot_enrich_fingerprint_001";

function createRuntimeConfig(): Config {
  return {
    app: {
      nodeEnv: "test",
      logLevel: "silent",
      host: "0.0.0.0",
      port: 3000,
    },
    database: {
      url: "postgresql://radar:changeme@localhost:5432/radar_ia",
    },
    discord: {
      token: undefined,
      clientId: undefined,
      guildId: GUILD_ID,
      adminUserIds: [],
      channels: {
        annoncesMajeures: "999999999999999999",
        veillePertinente: CHANNEL_ID,
        fluxIa: "888888888888888888",
      },
    },
    ollama: {
      baseUrl: "http://localhost:11434",
      model: "example-ministral-tag",
      maxConcurrency: 1,
    },
    publication: {
      threadArchiveDurationHours: 24,
    },
    sources: {
      registryPath: "config/sources.json",
      rawFeedRetentionPerSource: 20,
      rawFeedRetentionDays: 30,
    },
    worker: {
      schedulerEnabled: true,
      cycleIntervalMs: 900_000,
      initialDelayMs: 5_000,
      lockTtlMs: 300_000,
      heartbeatIntervalMs: 30_000,
      holderPrefix: "worker",
    },
  };
}

function permissionSet(hasAll = true) {
  return { has: vi.fn(() => hasAll) };
}

function createMessageDouble() {
  return {
    id: MESSAGE_ID,
    startThread: vi.fn(async () => ({ id: THREAD_ID })),
  };
}

function createTextChannelDouble(overrides: Record<string, unknown> = {}) {
  const message = createMessageDouble();
  return {
    id: CHANNEL_ID,
    type: 0,
    guild: { id: GUILD_ID },
    isTextBased: () => true,
    isSendable: () => true,
    permissionsFor: vi.fn(() => permissionSet(true)),
    send: vi.fn(async () => ({ id: MESSAGE_ID })),
    messages: { fetch: vi.fn(async () => message) },
    __message: message,
    ...overrides,
  };
}

function createThreadDouble(overrides: Record<string, unknown> = {}) {
  const thread: {
    id: string;
    type: ChannelType;
    archived: boolean;
    locked: boolean;
    isTextBased: () => boolean;
    isSendable: () => boolean;
    permissionsFor: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    setArchived: ReturnType<typeof vi.fn>;
  } = {
    id: THREAD_ID,
    type: ChannelType.PublicThread,
    archived: false,
    locked: false,
    isTextBased: () => true,
    isSendable: () => true,
    permissionsFor: vi.fn(() => permissionSet(true)),
    send: vi.fn(async () => ({ id: "423456789012345678" })),
    setArchived: vi.fn(),
    ...overrides,
  };
  thread.setArchived = vi.fn(async (archived: boolean) => {
    thread.archived = archived;
    return thread;
  });
  return thread;
}

function createClientDouble(
  channels: Record<string, unknown>,
  userId = "523456789012345678",
) {
  return {
    user: { id: userId },
    channels: {
      fetch: vi.fn(async (id: string) => channels[id] ?? null),
    },
  };
}

function publication(
  overrides: Partial<FolderPublicationRecord> = {},
): FolderPublicationRecord {
  const status = overrides.status ?? "none";
  const mainMessageId =
    overrides.mainMessageId !== undefined ? overrides.mainMessageId : null;
  const merged = {
    id: "fp_bot_1",
    folderId: FOLDER_ID,
    status,
    guildId: GUILD_ID,
    channelId: null as string | null,
    mainMessageId,
    threadId: null as string | null,
    sourceAnalysisAttemptId: null as string | null,
    lastErrorCode: null,
    createdAt: new Date("2026-07-16T21:00:00.000Z"),
    updatedAt: new Date("2026-07-16T21:00:00.000Z"),
    lastActivityAt: new Date("2026-07-16T21:00:00.000Z"),
    ...overrides,
  };
  return {
    ...merged,
    hasMainPublication: computeHasMainPublication(
      merged.status,
      merged.mainMessageId,
    ),
  };
}

function attempt(
  overrides: Partial<PublicationAttemptRecord> = {},
): PublicationAttemptRecord {
  return {
    id: "pa_bot_1",
    folderPublicationId: "fp_bot_1",
    folderId: FOLDER_ID,
    kind: "publish",
    attemptNumber: 1,
    idempotencyKey: buildPublishIdempotencyKey(FOLDER_ID),
    analysisAttemptId: ANALYSIS_ID,
    eventFingerprint: null,
    status: "reserved",
    discordMessageId: null,
    discordThreadId: null,
    errorCode: null,
    retryable: false,
    nextAttemptAt: null,
    durationMs: null,
    executionHolderId: null,
    executionLeaseExpiresAt: null,
    attemptedAt: new Date("2026-07-16T21:00:00.000Z"),
    createdAt: new Date("2026-07-16T21:00:00.000Z"),
    ...overrides,
  };
}

function createTrackingRepository(): PublicationRepository & {
  current: FolderPublicationRecord | null;
  attempts: PublicationAttemptRecord[];
} {
  let current: FolderPublicationRecord | null = null;
  const attempts: PublicationAttemptRecord[] = [];
  let seq = 0;

  const repo: PublicationRepository & {
    current: FolderPublicationRecord | null;
    attempts: PublicationAttemptRecord[];
  } = {
    get current() {
      return current;
    },
    set current(value) {
      current = value;
    },
    attempts,
    getOrCreateFolderPublication: vi.fn(async () => {
      if (current === null) {
        current = publication({ status: "none" });
      }
      return current;
    }),
    reservePublish: vi.fn(async () => {
      current = publication({ status: "pending" });
      const a = attempt({ id: `pa_${++seq}` });
      attempts.push(a);
      return { kind: "reserved" as const, publication: current, attempt: a };
    }),
    reserveOperation: vi.fn(async (input) => {
      const existing = attempts.find(
        (row) =>
          row.idempotencyKey === input.idempotencyKey &&
          (row.status === "reserved" || row.status === "succeeded"),
      );
      if (existing?.status === "succeeded") {
        return {
          kind: "idempotent_hit" as const,
          publication: current ?? publication(),
          attempt: existing,
          reason: "already_succeeded" as const,
        };
      }
      const a = attempt({
        id: `pa_${++seq}`,
        kind: input.kind,
        idempotencyKey: input.idempotencyKey,
        eventFingerprint: input.eventFingerprint ?? null,
      });
      attempts.push(a);
      return {
        kind: "reserved" as const,
        publication: current ?? publication(),
        attempt: a,
      };
    }),
    recordMainPublicationSuccess: vi.fn(async (input) => {
      current = publication({
        status: input.threadId ? "main_published" : "partial",
        channelId: input.channelId,
        mainMessageId: input.mainMessageId,
        threadId: input.threadId ?? null,
      });
      const a = attempt({
        id: `pa_${++seq}`,
        status: "succeeded",
        discordMessageId: input.mainMessageId,
        discordThreadId: input.threadId ?? null,
      });
      attempts.push(a);
      return { publication: current, attempt: a };
    }),
    recordThreadCreated: vi.fn(async (input) => {
      current = publication({
        status: "main_published",
        channelId: CHANNEL_ID,
        mainMessageId: current?.mainMessageId ?? MESSAGE_ID,
        threadId: input.threadId,
      });
      const a = attempt({
        id: `pa_${++seq}`,
        kind: "create_thread",
        status: "succeeded",
        idempotencyKey: buildCreateThreadIdempotencyKey(
          FOLDER_ID,
          current.mainMessageId!,
        ),
        discordThreadId: input.threadId,
      });
      attempts.push(a);
      return { publication: current, attempt: a };
    }),
    recordEnrichmentPublished: vi.fn(async (input) => {
      const a = attempt({
        id: `pa_${++seq}`,
        kind: "enrich",
        status: "succeeded",
        idempotencyKey: buildEnrichIdempotencyKey(
          FOLDER_ID,
          FINGERPRINT,
          ANALYSIS_ID,
        ),
        discordMessageId: input.discordMessageId,
      });
      attempts.push(a);
      return { publication: current!, attempt: a };
    }),
    recordFailure: vi.fn(async (input) => {
      const markFailed = input.markFolderFailed ?? true;
      if (markFailed && current?.mainMessageId == null) {
        current = publication({
          status: "failed",
          lastErrorCode: input.errorCode,
        });
      } else if (current) {
        current = { ...current, lastErrorCode: input.errorCode };
      }
      const a = attempt({
        id: `pa_${++seq}`,
        status: "failed",
        errorCode: input.errorCode,
        retryable: input.retryable,
      });
      attempts.push(a);
      return { publication: current ?? publication({ status: "failed" }), attempt: a };
    }),
    getPublicationByFolder: vi.fn(async () => current),
    listAttemptsForFolder: vi.fn(async () => [...attempts]),
    findAttemptByIdempotencyKey: vi.fn(async (key) =>
      [...attempts].reverse().find((a) => a.idempotencyKey === key) ?? null,
    ),
    findActiveAttemptByIdempotencyKey: vi.fn(async (key) =>
      [...attempts]
        .reverse()
        .find(
          (a) =>
            a.idempotencyKey === key &&
            (a.status === "reserved" || a.status === "succeeded"),
        ) ?? null,
    ),
    listRetryableAttempts: vi.fn(async () => []),
    listPublicationsNeedingResume: vi.fn(async () => []),
    claimExecution: vi.fn(async ({ attemptId, holderId, leaseMs }) => {
      const existing = attempts.find((row) => row.id === attemptId);
      if (existing === undefined || existing.status !== "reserved") {
        return null;
      }
      if (
        existing.executionHolderId != null &&
        existing.executionLeaseExpiresAt != null &&
        existing.executionLeaseExpiresAt.getTime() > Date.now() &&
        existing.executionHolderId !== holderId
      ) {
        return null;
      }
      existing.executionHolderId = holderId;
      existing.executionLeaseExpiresAt = new Date(Date.now() + leaseMs);
      return { ...existing };
    }),
    clearExecutionLease: vi.fn(async ({ attemptId, holderId }) => {
      const existing = attempts.find((row) => row.id === attemptId);
      if (existing === undefined) return null;
      if (existing.executionHolderId === holderId) {
        existing.executionHolderId = null;
        existing.executionLeaseExpiresAt = null;
      }
      return { ...existing };
    }),
  };

  return repo;
}

function createFolderRepository(): NewsFolderRepository {
  return {
    createFolder: vi.fn(),
    attachArticle: vi.fn(),
    recordDecision: vi.fn(),
    updateFolder: vi.fn(),
    getFolder: vi.fn(async () => ({
      id: FOLDER_ID,
      title: "OpenAI GPT-5",
      status: "open",
      lastActivityAt: new Date("2026-07-16T20:00:00.000Z"),
      closedAt: null,
      createdAt: new Date("2026-07-16T19:00:00.000Z"),
      updatedAt: new Date("2026-07-16T20:00:00.000Z"),
    })),
    listFolderArticles: vi.fn(async () => []),
    deleteFolder: vi.fn(),
  };
}

function publishInput(): PublicationOrchestrationInput {
  return {
    folderId: FOLDER_ID,
    decision: "publish",
    analysisAttemptId: ANALYSIS_ID,
    channelHint: "veille_pertinente",
    aggregateFingerprint: null,
    validatedContent: {
      summary: "Résumé validé de l'annonce GPT-5.",
      primaryCategory: "model_release",
      publishWorthiness: "medium",
      composite: 72,
    },
    sources: [{ name: "OpenAI", url: "https://openai.com/blog/gpt-5" }],
    usefulDate: "2026-07-16",
  };
}

function enrichInput(): PublicationOrchestrationInput {
  return {
    folderId: FOLDER_ID,
    decision: "enrich_thread_only",
    analysisAttemptId: ANALYSIS_ID,
    channelHint: null,
    aggregateFingerprint: FINGERPRINT,
    newFacts: [{ key: "model", value: "GPT-5" }],
    newSources: [],
  };
}

describe("008.1F bot adapter + orchestrator integration", () => {
  it("publish complet via adaptateur discord.js (sans réseau)", async () => {
    const textChannel = createTextChannelDouble();
    const client = createClientDouble({ [CHANNEL_ID]: textChannel });
    const adapter = createDiscordPublicationAdapter(client as never);
    const repository = createTrackingRepository();
    const resolveChannelId = createPublicationChannelResolver(
      createRuntimeConfig(),
    );

    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const orchestrator = createPublicationOrchestrator({} as never, {
      discordPort: adapter,
      resolveChannelId,
      guildId: GUILD_ID,
      publicationRepository: repository,
      folderRepository: createFolderRepository(),
    });

    const result = await orchestrator.process(publishInput());

    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded") return;
    expect(result.mainMessageId).toBe(MESSAGE_ID);
    expect(result.threadId).toBe(THREAD_ID);
    expect(textChannel.send).toHaveBeenCalledTimes(1);
    expect(textChannel.__message.startThread).toHaveBeenCalledWith({
      name: expect.stringContaining("Veille"),
      autoArchiveDuration: PUBLICATION_THREAD_AUTO_ARCHIVE_MINUTES,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("salon absent côté Discord → channel_unavailable", async () => {
    const adapter = createDiscordPublicationAdapter(
      createClientDouble({}) as never,
    );
    const orchestrator = createPublicationOrchestrator({} as never, {
      discordPort: adapter,
      resolveChannelId: () => CHANNEL_ID,
      guildId: GUILD_ID,
      publicationRepository: createTrackingRepository(),
      folderRepository: createFolderRepository(),
    });

    const result = await orchestrator.process(publishInput());

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.error).toBe("channel_unavailable");
    expect(result.retryable).toBe(true);
  });

  it("thread archivé: unarchive puis enrichissement", async () => {
    const textChannel = createTextChannelDouble();
    const archivedThread = createThreadDouble({ archived: true });
    const client = createClientDouble({
      [CHANNEL_ID]: textChannel,
      [THREAD_ID]: archivedThread,
    });
    const adapter = createDiscordPublicationAdapter(client as never);
    const repository = createTrackingRepository();

    const orchestrator = createPublicationOrchestrator({} as never, {
      discordPort: adapter,
      resolveChannelId: createPublicationChannelResolver(createRuntimeConfig()),
      guildId: GUILD_ID,
      publicationRepository: repository,
      folderRepository: createFolderRepository(),
    });

    const published = await orchestrator.process(publishInput());
    expect(published.kind).toBe("succeeded");
    const enrich = await orchestrator.process(enrichInput());

    expect(enrich).toMatchObject({ kind: "enriched" });
    expect(archivedThread.setArchived).toHaveBeenCalledWith(
      false,
      "Radar IA publication enrichment",
    );
  });

  it("thread verrouillé: enrich → inconsistent_state (pas de recreate)", async () => {
    const textChannel = createTextChannelDouble();
    const lockedThread = createThreadDouble({
      archived: true,
      locked: true,
    });
    const client = createClientDouble({
      [CHANNEL_ID]: textChannel,
      [THREAD_ID]: lockedThread,
    });
    const adapter = createDiscordPublicationAdapter(client as never);
    const repository = createTrackingRepository();

    const orchestrator = createPublicationOrchestrator({} as never, {
      discordPort: adapter,
      resolveChannelId: createPublicationChannelResolver(createRuntimeConfig()),
      guildId: GUILD_ID,
      publicationRepository: repository,
      folderRepository: createFolderRepository(),
    });

    await orchestrator.process(publishInput());
    const enrich = await orchestrator.process(enrichInput());

    expect(enrich.kind).toBe("failed");
    if (enrich.kind !== "failed") return;
    expect(enrich.error).toBe("inconsistent_state");
    expect(lockedThread.send).not.toHaveBeenCalled();
  });

  it("le bot n'introduit aucune décision métier (port pur)", async () => {
    const adapter = createDiscordPublicationAdapter(
      createClientDouble({ [CHANNEL_ID]: createTextChannelDouble() }) as never,
    );

    // Adapter has no knowledge of hold / reject / publishWorthiness
    expect(adapter).not.toHaveProperty("process");
    expect(typeof adapter.sendMainMessage).toBe("function");
    expect(typeof adapter.startThread).toBe("function");
    expect(typeof adapter.sendThreadMessage).toBe("function");

    await expect(
      adapter.sendMainMessage({
        channelId: "missing",
        content: { content: "x", embeds: [] },
      }),
    ).rejects.toBeInstanceOf(DiscordPublicationPortError);
  });
});
