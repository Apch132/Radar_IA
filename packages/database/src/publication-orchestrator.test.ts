import { describe, expect, it, vi } from "vitest";
import type {
  BuildEnrichmentPublicationContentResult,
  BuildMainPublicationContentResult,
  RenderedDiscordPayload,
} from "@radar-ia/shared";

import {
  createPublicationOrchestrator,
  type PublicationOrchestratorOptions,
} from "./publication-orchestrator.js";
import {
  DiscordPublicationPortError,
  PUBLICATION_THREAD_AUTO_ARCHIVE_MINUTES,
  type DiscordPublicationPort,
  type PublicationOrchestrationInput,
} from "./publication-orchestration-types.js";
import type { NewsFolderRepository } from "./news-folder-repository.js";
import type { PublicationRepository } from "./publication-repository.js";
import {
  PublicationPersistenceError,
  buildCreateThreadIdempotencyKey,
  buildEnrichIdempotencyKey,
  buildPublishIdempotencyKey,
  computeHasMainPublication,
  type FolderPublicationRecord,
  type PublicationAttemptRecord,
} from "./publication-types.js";

const GUILD_ID = "guild_1";
const CHANNEL_ID = "channel_veille";
const FOLDER_ID = "fld_publish_1";
const ANALYSIS_ID = "att_analysis_1";
const FINGERPRINT = "abc123fingerprint";

const MAIN_PAYLOAD: RenderedDiscordPayload = {
  content: "Titre — https://example.com",
  embeds: [{ title: "Titre", description: "Résumé" }],
};

const ENRICH_PAYLOAD: RenderedDiscordPayload = {
  content: "Enrichissement",
  embeds: [{ title: "Enrichissement", description: "• model: GPT-5" }],
};

function baseValidatedContent() {
  return {
    summary: "Résumé validé de l'annonce.",
    primaryCategory: "model_release",
    publishWorthiness: "medium",
    composite: 72,
  };
}

function publication(
  overrides: Partial<FolderPublicationRecord> = {},
): FolderPublicationRecord {
  const status = overrides.status ?? "none";
  const mainMessageId =
    overrides.mainMessageId !== undefined ? overrides.mainMessageId : null;
  const merged = {
    id: "fp_1",
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
    id: "pa_1",
    folderPublicationId: "fp_1",
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

function openFolder(overrides: Record<string, unknown> = {}) {
  return {
    id: FOLDER_ID,
    title: "OpenAI GPT-5",
    status: "open",
    lastActivityAt: new Date("2026-07-16T20:00:00.000Z"),
    closedAt: null,
    createdAt: new Date("2026-07-16T19:00:00.000Z"),
    updatedAt: new Date("2026-07-16T20:00:00.000Z"),
    ...overrides,
  };
}

function mainBuildResult(
  overrides: Partial<BuildMainPublicationContentResult> = {},
): BuildMainPublicationContentResult {
  return {
    payload: MAIN_PAYLOAD,
    threadName: "Veille — OpenAI GPT-5",
    channelRole: "VEILLE_PERTINENTE",
    warnings: [],
    ...overrides,
  };
}

function enrichBuildResult(): BuildEnrichmentPublicationContentResult {
  return {
    payload: ENRICH_PAYLOAD,
    warnings: [],
  };
}

function publishInput(
  overrides: Partial<PublicationOrchestrationInput> = {},
): PublicationOrchestrationInput {
  return {
    folderId: FOLDER_ID,
    decision: "publish",
    analysisAttemptId: ANALYSIS_ID,
    channelHint: "veille_pertinente",
    aggregateFingerprint: null,
    validatedContent: baseValidatedContent(),
    sources: [{ name: "OpenAI", url: "https://openai.com/blog" }],
    usefulDate: "2026-07-16",
    ...overrides,
  };
}

function enrichInput(
  overrides: Partial<PublicationOrchestrationInput> = {},
): PublicationOrchestrationInput {
  return {
    folderId: FOLDER_ID,
    decision: "enrich_thread_only",
    analysisAttemptId: ANALYSIS_ID,
    channelHint: null,
    aggregateFingerprint: FINGERPRINT,
    newFacts: [{ key: "model", value: "GPT-5" }],
    newSources: [],
    ...overrides,
  };
}

function createHarness(
  overrides: {
    folder?: ReturnType<typeof openFolder> | null;
    publicationRepo?: Partial<PublicationRepository>;
    discord?: Partial<DiscordPublicationPort>;
    resolveChannelId?: (hint: string) => string | null;
    builders?: PublicationOrchestratorOptions["builders"];
  } = {},
) {
  const folder = overrides.folder === undefined ? openFolder() : overrides.folder;

  const folderRepository: NewsFolderRepository = {
    createFolder: vi.fn(),
    attachArticle: vi.fn(),
    recordDecision: vi.fn(),
    updateFolder: vi.fn(),
    getFolder: vi.fn(async () => folder as never),
    listFolderArticles: vi.fn(async () => []),
    listFoldersByStatuses: vi.fn(async () => []),
    getArticleMembership: vi.fn(async () => null),
    hasMatchingDecisionForArticle: vi.fn(async () => false),
    deleteFolder: vi.fn(),
  };

  let currentPublication: FolderPublicationRecord | null = null;

  const publicationRepository: PublicationRepository = {
    getOrCreateFolderPublication: vi.fn(),
    reservePublish: vi.fn(async () => {
      currentPublication = publication({ status: "pending" });
      return {
        kind: "reserved" as const,
        publication: currentPublication,
        attempt: attempt(),
      };
    }),
    reserveOperation: vi.fn(async (input) => {
      const a = attempt({
        id: `pa_${input.kind}`,
        kind: input.kind,
        idempotencyKey: input.idempotencyKey,
        eventFingerprint: input.eventFingerprint ?? null,
      });
      return {
        kind: "reserved" as const,
        publication: currentPublication ?? publication(),
        attempt: a,
      };
    }),
    recordMainPublicationSuccess: vi.fn(async (input) => {
      currentPublication = publication({
        status: input.threadId ? "main_published" : "partial",
        channelId: input.channelId,
        mainMessageId: input.mainMessageId,
        threadId: input.threadId ?? null,
      });
      return {
        publication: currentPublication,
        attempt: attempt({
          status: "succeeded",
          discordMessageId: input.mainMessageId,
          discordThreadId: input.threadId ?? null,
        }),
      };
    }),
    recordThreadCreated: vi.fn(async (input) => {
      currentPublication = publication({
        status: "main_published",
        channelId: CHANNEL_ID,
        mainMessageId: currentPublication?.mainMessageId ?? "msg_1",
        threadId: input.threadId,
      });
      return {
        publication: currentPublication,
        attempt: attempt({
          id: "pa_create_thread",
          kind: "create_thread",
          status: "succeeded",
          discordThreadId: input.threadId,
        }),
      };
    }),
    recordEnrichmentPublished: vi.fn(async (input) => {
      currentPublication = publication({
        status: "main_published",
        channelId: CHANNEL_ID,
        mainMessageId: "msg_1",
        threadId: "thr_1",
      });
      return {
        publication: currentPublication,
        attempt: attempt({
          id: "pa_enrich",
          kind: "enrich",
          status: "succeeded",
          discordMessageId: input.discordMessageId,
        }),
      };
    }),
    recordFailure: vi.fn(async (input) => {
      const markFailed = input.markFolderFailed ?? true;
      if (markFailed && currentPublication?.mainMessageId == null) {
        currentPublication = publication({
          status: "failed",
          lastErrorCode: input.errorCode,
        });
      } else if (currentPublication) {
        currentPublication = {
          ...currentPublication,
          lastErrorCode: input.errorCode,
        };
      }
      return {
        publication: currentPublication ?? publication({ status: "failed" }),
        attempt: attempt({
          status: "failed",
          errorCode: input.errorCode,
          retryable: input.retryable,
        }),
      };
    }),
    getPublicationByFolder: vi.fn(async () => currentPublication),
    listAttemptsForFolder: vi.fn(async () => []),
    findAttemptByIdempotencyKey: vi.fn(async () => null),
    findActiveAttemptByIdempotencyKey: vi.fn(async () => null),
    listRetryableAttempts: vi.fn(async () => []),
    listPublicationsNeedingResume: vi.fn(async () => []),
    claimExecution: vi.fn(async ({ attemptId, holderId, leaseMs }) =>
      attempt({
        id: attemptId,
        status: "reserved",
        executionHolderId: holderId,
        executionLeaseExpiresAt: new Date(Date.now() + leaseMs),
      }),
    ),
    clearExecutionLease: vi.fn(async ({ attemptId }) =>
      attempt({ id: attemptId, status: "reserved", executionHolderId: null }),
    ),
    ...overrides.publicationRepo,
  };

  // Allow tests to seed current publication via getPublicationByFolder override
  const originalGet = publicationRepository.getPublicationByFolder;
  if (!overrides.publicationRepo?.getPublicationByFolder) {
    publicationRepository.getPublicationByFolder = vi.fn(async () => {
      return currentPublication;
    });
  } else {
    // Keep seeded getter; also track updates from record* mocks if not overridden
    void originalGet;
  }

  const setPublication = (pub: FolderPublicationRecord | null) => {
    currentPublication = pub;
  };

  const discord: DiscordPublicationPort = {
    sendMainMessage: vi.fn(async () => ({ messageId: "msg_1" })),
    startThread: vi.fn(async () => ({ threadId: "thr_1" })),
    unarchiveThreadIfNeeded: vi.fn(async () => undefined),
    sendThreadMessage: vi.fn(async () => ({ messageId: "thr_msg_1" })),
    ...overrides.discord,
  };

  const buildMain = vi.fn(() => mainBuildResult());
  const buildEnrichment = vi.fn(() => enrichBuildResult());

  const orchestrator = createPublicationOrchestrator({} as never, {
    discordPort: discord,
    resolveChannelId:
      overrides.resolveChannelId ??
      ((hint) => (hint === "veille_pertinente" ? CHANNEL_ID : null)),
    guildId: GUILD_ID,
    publicationRepository,
    folderRepository,
    builders: {
      buildMain,
      buildEnrichment,
      ...overrides.builders,
    },
    now: () => new Date("2026-07-16T21:30:00.000Z"),
  });

  return {
    orchestrator,
    discord,
    publicationRepository,
    folderRepository,
    buildMain,
    buildEnrichment,
    setPublication,
  };
}

describe("createPublicationOrchestrator", () => {
  it("publish nominal: reserve → build → Discord → persist IDs → succeeded", async () => {
    const h = createHarness();
    const result = await h.orchestrator.process(publishInput());

    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded") return;

    expect(result.mainMessageId).toBe("msg_1");
    expect(result.threadId).toBe("thr_1");
    expect(result.publication.status).toBe("main_published");
    expect(result.publication.hasMainPublication).toBe(true);

    expect(h.publicationRepository.reservePublish).toHaveBeenCalledTimes(1);
    expect(h.buildMain).toHaveBeenCalledTimes(1);
    expect(h.discord.sendMainMessage).toHaveBeenCalledWith({
      channelId: CHANNEL_ID,
      content: MAIN_PAYLOAD,
    });
    expect(h.discord.startThread).toHaveBeenCalledWith({
      channelId: CHANNEL_ID,
      messageId: "msg_1",
      name: "Veille — OpenAI GPT-5",
      autoArchiveMinutes: PUBLICATION_THREAD_AUTO_ARCHIVE_MINUTES,
    });
    expect(
      h.publicationRepository.recordMainPublicationSuccess,
    ).toHaveBeenCalled();
    expect(h.publicationRepository.recordThreadCreated).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: "thr_1" }),
    );
    expect(h.discord.sendThreadMessage).not.toHaveBeenCalled();
  });

  it("enrich nominal: unarchive → thread message → record enrichment", async () => {
    const h = createHarness();
    h.setPublication(
      publication({
        status: "main_published",
        channelId: CHANNEL_ID,
        mainMessageId: "msg_1",
        threadId: "thr_1",
      }),
    );

    const result = await h.orchestrator.process(enrichInput());

    expect(result.kind).toBe("enriched");
    if (result.kind !== "enriched") return;
    expect(result.threadMessageId).toBe("thr_msg_1");

    expect(h.buildEnrichment).toHaveBeenCalledTimes(1);
    expect(h.publicationRepository.reserveOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "enrich",
        idempotencyKey: buildEnrichIdempotencyKey(
          FOLDER_ID,
          FINGERPRINT,
          ANALYSIS_ID,
        ),
      }),
    );
    expect(h.discord.unarchiveThreadIfNeeded).toHaveBeenCalledWith({
      threadId: "thr_1",
    });
    expect(h.discord.sendThreadMessage).toHaveBeenCalledWith({
      threadId: "thr_1",
      content: ENRICH_PAYLOAD,
    });
    expect(h.discord.sendMainMessage).not.toHaveBeenCalled();
    expect(
      h.publicationRepository.recordEnrichmentPublished,
    ).toHaveBeenCalled();
  });

  it("hold: no Discord, no repository mutation", async () => {
    const h = createHarness();
    const result = await h.orchestrator.process({
      folderId: FOLDER_ID,
      decision: "hold",
      analysisAttemptId: null,
      channelHint: null,
      aggregateFingerprint: null,
    });

    expect(result).toEqual({
      kind: "skipped",
      reason: "hold",
      folderId: FOLDER_ID,
      publication: null,
      attempt: null,
      errorCode: "hold",
    });
    expect(h.discord.sendMainMessage).not.toHaveBeenCalled();
    expect(h.discord.startThread).not.toHaveBeenCalled();
    expect(h.discord.sendThreadMessage).not.toHaveBeenCalled();
    expect(h.publicationRepository.reservePublish).not.toHaveBeenCalled();
    expect(h.folderRepository.getFolder).not.toHaveBeenCalled();
  });

  it("reject_editorial: no Discord, deterministic skip", async () => {
    const h = createHarness();
    const result = await h.orchestrator.process({
      folderId: FOLDER_ID,
      decision: "reject_editorial",
      analysisAttemptId: null,
      channelHint: null,
      aggregateFingerprint: null,
    });

    expect(result.kind).toBe("skipped");
    if (result.kind !== "skipped") return;
    expect(result.reason).toBe("reject_editorial");
    expect(result.errorCode).toBe("reject_editorial");
    expect(h.discord.sendMainMessage).not.toHaveBeenCalled();
    expect(h.publicationRepository.reservePublish).not.toHaveBeenCalled();
  });

  it("Discord port error on sendMainMessage → failed + recordFailure", async () => {
    const h = createHarness({
      discord: {
        sendMainMessage: vi.fn(async () => {
          throw new DiscordPublicationPortError(
            "discord_unavailable",
            "gateway down",
          );
        }),
      },
    });

    const result = await h.orchestrator.process(publishInput());

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.error).toBe("discord_unavailable");
    expect(result.retryable).toBe(true);
    expect(h.publicationRepository.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "discord_unavailable",
        retryable: true,
        markFolderFailed: true,
      }),
    );
    expect(h.discord.startThread).not.toHaveBeenCalled();
  });

  it("succès partiel: message OK, startThread KO → partial", async () => {
    const h = createHarness({
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

    const result = await h.orchestrator.process(publishInput());

    expect(result.kind).toBe("partial");
    if (result.kind !== "partial") return;
    expect(result.mainMessageId).toBe("msg_1");
    expect(result.pending).toBe("thread");
    expect(result.errorCode).toBe("missing_permission");
    expect(h.publicationRepository.recordMainPublicationSuccess).toHaveBeenCalled();
    expect(h.publicationRepository.recordFailure).toHaveBeenCalledWith(
      expect.objectContaining({
        markFolderFailed: false,
        errorCode: "missing_permission",
      }),
    );
  });

  it("idempotence publish: already hasMainPublication → idempotent_hit", async () => {
    const h = createHarness({
      publicationRepo: {
        getPublicationByFolder: vi.fn(async () =>
          publication({
            status: "main_published",
            channelId: CHANNEL_ID,
            mainMessageId: "msg_existing",
            threadId: "thr_existing",
          }),
        ),
      },
    });

    const result = await h.orchestrator.process(publishInput());

    expect(result.kind).toBe("skipped");
    if (result.kind !== "skipped") return;
    expect(result.reason).toBe("idempotent_hit");
    expect(h.discord.sendMainMessage).not.toHaveBeenCalled();
    expect(h.publicationRepository.reservePublish).not.toHaveBeenCalled();
  });

  it("idempotence enrich: same key already succeeded → idempotent_hit", async () => {
    const existingAttempt = attempt({
      id: "pa_enrich_done",
      kind: "enrich",
      status: "succeeded",
      idempotencyKey: buildEnrichIdempotencyKey(
        FOLDER_ID,
        FINGERPRINT,
        ANALYSIS_ID,
      ),
      discordMessageId: "thr_msg_old",
    });
    const h = createHarness({
      publicationRepo: {
        getPublicationByFolder: vi.fn(async () =>
          publication({
            status: "main_published",
            channelId: CHANNEL_ID,
            mainMessageId: "msg_1",
            threadId: "thr_1",
          }),
        ),
        reserveOperation: vi.fn(async () => ({
          kind: "idempotent_hit" as const,
          publication: publication({
            status: "main_published",
            channelId: CHANNEL_ID,
            mainMessageId: "msg_1",
            threadId: "thr_1",
          }),
          attempt: existingAttempt,
          reason: "already_succeeded" as const,
        })),
      },
    });

    const result = await h.orchestrator.process(enrichInput());

    expect(result.kind).toBe("skipped");
    if (result.kind !== "skipped") return;
    expect(result.reason).toBe("idempotent_hit");
    expect(h.discord.sendThreadMessage).not.toHaveBeenCalled();
  });

  it("reprise: resume() on partial creates thread only", async () => {
    const h = createHarness({
      publicationRepo: {
        getPublicationByFolder: vi.fn(async () =>
          publication({
            status: "partial",
            channelId: CHANNEL_ID,
            mainMessageId: "msg_partial",
            threadId: null,
          }),
        ),
        findActiveAttemptByIdempotencyKey: vi.fn(async () =>
          attempt({ status: "succeeded", discordMessageId: "msg_partial" }),
        ),
      },
    });

    const result = await h.orchestrator.resume(FOLDER_ID);

    expect(result.kind).toBe("succeeded");
    if (result.kind !== "succeeded") return;
    expect(result.mainMessageId).toBe("msg_partial");
    expect(result.threadId).toBe("thr_1");
    expect(h.discord.sendMainMessage).not.toHaveBeenCalled();
    expect(h.discord.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: "msg_partial",
        autoArchiveMinutes: 1440,
      }),
    );
    expect(h.publicationRepository.reserveOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "create_thread",
        idempotencyKey: buildCreateThreadIdempotencyKey(
          FOLDER_ID,
          "msg_partial",
        ),
      }),
    );
  });

  it("transitions interdites: enrich sans publication principale", async () => {
    const h = createHarness({
      publicationRepo: {
        getPublicationByFolder: vi.fn(async () => null),
      },
    });

    const result = await h.orchestrator.process(enrichInput());

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.error).toBe("precondition_failed");
    expect(h.discord.sendThreadMessage).not.toHaveBeenCalled();
    expect(h.publicationRepository.reserveOperation).not.toHaveBeenCalled();
  });

  it("transitions interdites: dossier closed → folder_closed skip", async () => {
    const h = createHarness({
      folder: openFolder({ status: "closed" }),
    });

    const result = await h.orchestrator.process(publishInput());

    expect(result.kind).toBe("skipped");
    if (result.kind !== "skipped") return;
    expect(result.reason).toBe("folder_closed");
    expect(h.discord.sendMainMessage).not.toHaveBeenCalled();
  });

  it("transitions interdites: channelHint none → channel_unmapped", async () => {
    const h = createHarness();
    const result = await h.orchestrator.process(
      publishInput({ channelHint: "none" }),
    );

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.error).toBe("channel_unmapped");
    expect(h.discord.sendMainMessage).not.toHaveBeenCalled();
  });

  it("channel unmapped by resolver → channel_unmapped", async () => {
    const h = createHarness({
      resolveChannelId: () => null,
    });

    const result = await h.orchestrator.process(publishInput());

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.error).toBe("channel_unmapped");
  });

  it("appelle le repository avant le port Discord (ordre réserve)", async () => {
    const order: string[] = [];
    const h = createHarness({
      publicationRepo: {
        reservePublish: vi.fn(async () => {
          order.push("reserve");
          return {
            kind: "reserved" as const,
            publication: publication({ status: "pending" }),
            attempt: attempt(),
          };
        }),
        getPublicationByFolder: vi.fn(async () => null),
      },
      discord: {
        sendMainMessage: vi.fn(async () => {
          order.push("discord");
          return { messageId: "msg_1" };
        }),
      },
    });

    await h.orchestrator.process(publishInput());

    expect(order.indexOf("reserve")).toBeLessThan(order.indexOf("discord"));
  });

  it("appelle les builders avant le port Discord", async () => {
    const order: string[] = [];
    const h = createHarness({
      discord: {
        sendMainMessage: vi.fn(async () => {
          order.push("discord");
          return { messageId: "msg_1" };
        }),
      },
    });
    h.buildMain.mockImplementation(() => {
      order.push("build");
      return mainBuildResult();
    });

    await h.orchestrator.process(publishInput());

    expect(order.indexOf("build")).toBeLessThan(order.indexOf("discord"));
  });

  it("n'appelle jamais sendMainMessage pour enrich", async () => {
    const h = createHarness();
    h.setPublication(
      publication({
        status: "main_published",
        channelId: CHANNEL_ID,
        mainMessageId: "msg_1",
        threadId: "thr_1",
      }),
    );

    await h.orchestrator.process(enrichInput());

    expect(h.discord.sendMainMessage).not.toHaveBeenCalled();
    expect(h.discord.startThread).not.toHaveBeenCalled();
  });

  it("persistence error on reservePublish maps to failed", async () => {
    const h = createHarness({
      publicationRepo: {
        getPublicationByFolder: vi.fn(async () => null),
        reservePublish: vi.fn(async () => {
          throw new PublicationPersistenceError(
            "forbidden_status_transition",
            "illegal",
          );
        }),
      },
    });

    const result = await h.orchestrator.process(publishInput());

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.error).toBe("inconsistent_state");
  });

  it("publish with missing analysisAttemptId → precondition_failed", async () => {
    const h = createHarness();
    const result = await h.orchestrator.process(
      publishInput({ analysisAttemptId: null }),
    );

    expect(result.kind).toBe("failed");
    if (result.kind !== "failed") return;
    expect(result.error).toBe("precondition_failed");
    expect(h.discord.sendMainMessage).not.toHaveBeenCalled();
  });
});
