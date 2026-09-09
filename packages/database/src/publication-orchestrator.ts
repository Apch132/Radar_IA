import type { PrismaClient } from "@prisma/client";
import {
  CHANNEL_HINT_TO_ROLE,
  PublicationContentError,
  buildEnrichmentPublicationContent,
  buildMainPublicationContent,
  type BuildEnrichmentPublicationContentResult,
  type BuildMainPublicationContentResult,
  type PublicationChannelHint,
  type PublicationChannelRole,
} from "@radar-ia/shared";

import { createNewsFolderRepository } from "./news-folder-repository.js";
import type { NewsFolderRepository } from "./news-folder-repository.js";
import {
  DiscordPublicationPortError,
  PUBLICATION_THREAD_AUTO_ARCHIVE_MINUTES,
  PublicationOrchestrationError,
  type DiscordPublicationPort,
  type PublicationChannelResolver,
  type PublicationOrchestrationInput,
  type PublicationOrchestrationResult,
} from "./publication-orchestration-types.js";
import { createPublicationRepository } from "./publication-repository.js";
import type { PublicationRepository } from "./publication-repository.js";
import {
  PublicationPersistenceError,
  buildCreateThreadIdempotencyKey,
  buildEnrichIdempotencyKey,
  buildPublishIdempotencyKey,
  type FolderPublicationRecord,
  type PublicationAttemptRecord,
  type PublicationErrorCode,
} from "./publication-types.js";

/**
 * Transaction / side-effect boundaries (008.1D / gel 008.1A §9):
 * - Reserve DB (PublicationAttempt + FolderPublication) BEFORE any Discord call.
 * - Discord calls go ONLY through DiscordPublicationPort (no discord.js here).
 * - Persist snowflakes after each Discord success; never double-publish.
 * - hold / reject_editorial: deterministic skip, zero Discord, no FolderPublication mutation.
 */

export interface PublicationOrchestrator {
  /**
   * Execute one publication command for a folder (gel §6).
   * Never reinterprets the 007 decision.
   */
  process(
    input: PublicationOrchestrationInput,
  ): Promise<PublicationOrchestrationResult>;

  /**
   * Resume a pending / partial main publication (create_thread if needed).
   * Does not invent a new publish; uses existing snowflakes / reserved attempts.
   */
  resume(folderId: string): Promise<PublicationOrchestrationResult>;
}

export interface PublicationContentBuilders {
  buildMain: (
    input: Parameters<typeof buildMainPublicationContent>[0],
  ) => BuildMainPublicationContentResult;
  buildEnrichment: (
    input: Parameters<typeof buildEnrichmentPublicationContent>[0],
  ) => BuildEnrichmentPublicationContentResult;
}

export interface PublicationOrchestratorOptions {
  /** Injected Discord port (required — no default discord.js). */
  discordPort: DiscordPublicationPort;
  /** Hint → channel snowflake (config mapping only). */
  resolveChannelId: PublicationChannelResolver;
  /** Guild snowflake for FolderPublication.guildId. */
  guildId: string;
  publicationRepository?: PublicationRepository;
  folderRepository?: NewsFolderRepository;
  builders?: Partial<PublicationContentBuilders>;
  /** Optional clock for durationMs. */
  now?: () => Date;
  /** Holder id for Discord execution lease (010.1A AUD-002). */
  executionHolderId?: string;
  /** Lease duration for Discord I/O (default 120s). */
  executionLeaseMs?: number;
  /** Structured publication logs (no secrets). */
  logger?: {
    info?(message: string, detail?: Record<string, unknown>): void;
    warn?(message: string, detail?: Record<string, unknown>): void;
  };
}

const PUBLISHABLE_HINTS: readonly PublicationChannelHint[] = [
  "annonces_majeures",
  "veille_pertinente",
  "flux_ia",
];

function isPublishableHint(
  hint: string | null | undefined,
): hint is PublicationChannelHint {
  return (
    hint !== null &&
    hint !== undefined &&
    (PUBLISHABLE_HINTS as readonly string[]).includes(hint)
  );
}

function skipped(input: {
  reason: Extract<
    PublicationOrchestrationResult,
    { kind: "skipped" }
  >["reason"];
  folderId: string;
  publication?: FolderPublicationRecord | null;
  attempt?: PublicationAttemptRecord | null;
  errorCode?: PublicationErrorCode | null;
}): PublicationOrchestrationResult {
  return {
    kind: "skipped",
    reason: input.reason,
    folderId: input.folderId,
    publication: input.publication ?? null,
    attempt: input.attempt ?? null,
    errorCode: input.errorCode ?? null,
  };
}

function failed(input: {
  folderId: string;
  error: PublicationErrorCode;
  retryable: boolean;
  publication?: FolderPublicationRecord | null;
  attempt?: PublicationAttemptRecord | null;
}): PublicationOrchestrationResult {
  return {
    kind: "failed",
    folderId: input.folderId,
    error: input.error,
    retryable: input.retryable,
    publication: input.publication ?? null,
    attempt: input.attempt ?? null,
  };
}

function mapPersistenceError(
  error: PublicationPersistenceError,
): PublicationErrorCode {
  switch (error.code) {
    case "folder_closed":
      return "folder_closed";
    case "folder_absent":
    case "enrichment_precondition_failed":
    case "main_already_reserved_or_exists":
      return "precondition_failed";
    case "forbidden_status_transition":
    case "inconsistent_state":
      return "inconsistent_state";
    case "invalid_idempotency_key":
      return "precondition_failed";
    default: {
      const _exhaustive: never = error.code;
      return _exhaustive;
    }
  }
}

function isRetryablePortCode(code: PublicationErrorCode): boolean {
  return (
    code === "discord_rate_limited" ||
    code === "discord_timeout" ||
    code === "discord_unavailable" ||
    code === "channel_unavailable"
  );
}

function mapPortError(error: unknown): {
  code: PublicationErrorCode;
  retryable: boolean;
  message: string;
} {
  if (error instanceof DiscordPublicationPortError) {
    return {
      code: error.code,
      retryable: error.retryable,
      message: error.message,
    };
  }
  if (error instanceof Error) {
    return {
      code: "unknown",
      retryable: false,
      message: error.message,
    };
  }
  return {
    code: "unknown",
    retryable: false,
    message: String(error),
  };
}

function requireNonEmpty(value: string | null | undefined, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PublicationOrchestrationError(`${label} is required`);
  }
  return value;
}

function resolveBuilders(
  options: PublicationOrchestratorOptions,
): PublicationContentBuilders {
  return {
    buildMain: options.builders?.buildMain ?? buildMainPublicationContent,
    buildEnrichment:
      options.builders?.buildEnrichment ?? buildEnrichmentPublicationContent,
  };
}

/**
 * Factory for the Discord publication orchestrator (008.1D).
 * Wiring: repository (008.1B) → builders (008.1C) → Discord port (interface only).
 */
export function createPublicationOrchestrator(
  prisma: PrismaClient,
  options: PublicationOrchestratorOptions,
): PublicationOrchestrator {
  if (!options.discordPort) {
    throw new PublicationOrchestrationError(
      "createPublicationOrchestrator requires discordPort",
    );
  }
  if (!options.resolveChannelId) {
    throw new PublicationOrchestrationError(
      "createPublicationOrchestrator requires resolveChannelId",
    );
  }
  const guildId = requireNonEmpty(options.guildId, "guildId");

  const publicationRepository =
    options.publicationRepository ?? createPublicationRepository(prisma);
  const folderRepository =
    options.folderRepository ?? createNewsFolderRepository(prisma);
  const builders = resolveBuilders(options);
  const discord = options.discordPort;
  const resolveChannelId = options.resolveChannelId;
  const now = options.now ?? (() => new Date());
  const executionHolderId =
    options.executionHolderId ??
    `pub:${process.pid}:${Math.random().toString(36).slice(2, 10)}`;
  const executionLeaseMs = options.executionLeaseMs ?? 120_000;
  const logger = options.logger;

  function logPublication(
    event: string,
    detail: Record<string, unknown>,
  ): void {
    logger?.info?.(event, { event, ...detail });
  }

  async function claimDiscordExecution(
    attemptId: string,
  ): Promise<PublicationAttemptRecord | null> {
    return publicationRepository.claimExecution({
      attemptId,
      holderId: executionHolderId,
      leaseMs: executionLeaseMs,
      now: now(),
    });
  }

  async function releaseDiscordExecution(attemptId: string): Promise<void> {
    try {
      await publicationRepository.clearExecutionLease({
        attemptId,
        holderId: executionHolderId,
      });
    } catch {
      // best-effort — lease TTL recovers
    }
  }

  async function loadFolderOrFail(
    folderId: string,
  ): Promise<
    | { ok: true; folder: NonNullable<Awaited<ReturnType<NewsFolderRepository["getFolder"]>>> }
    | { ok: false; result: PublicationOrchestrationResult }
  > {
    const folder = await folderRepository.getFolder(folderId);
    if (folder === null) {
      return {
        ok: false,
        result: failed({
          folderId,
          error: "precondition_failed",
          retryable: false,
        }),
      };
    }
    if (folder.status === "closed") {
      return {
        ok: false,
        result: skipped({
          reason: "folder_closed",
          folderId,
          errorCode: "folder_closed",
        }),
      };
    }
    return { ok: true, folder };
  }

  async function recordPortFailure(input: {
    folderId: string;
    attemptId?: string;
    idempotencyKey?: string;
    code: PublicationErrorCode;
    retryable: boolean;
    markFolderFailed?: boolean;
    startedAt: number;
  }): Promise<{
    publication: FolderPublicationRecord | null;
    attempt: PublicationAttemptRecord | null;
  }> {
    try {
      const recorded = await publicationRepository.recordFailure({
        folderId: input.folderId,
        attemptId: input.attemptId,
        idempotencyKey: input.idempotencyKey,
        errorCode: input.code,
        retryable: input.retryable,
        durationMs: Math.max(0, now().getTime() - input.startedAt),
        markFolderFailed: input.markFolderFailed,
      });
      return {
        publication: recorded.publication,
        attempt: recorded.attempt,
      };
    } catch {
      return { publication: null, attempt: null };
    }
  }

  async function completeThread(input: {
    folderId: string;
    channelId: string;
    mainMessageId: string;
    threadName: string;
    channelRole: PublicationChannelRole;
    startedAt: number;
  }): Promise<PublicationOrchestrationResult> {
    const threadKey = buildCreateThreadIdempotencyKey(
      input.folderId,
      input.mainMessageId,
    );

    let threadReserve;
    try {
      threadReserve = await publicationRepository.reserveOperation({
        folderId: input.folderId,
        kind: "create_thread",
        idempotencyKey: threadKey,
      });
    } catch (error) {
      if (error instanceof PublicationPersistenceError) {
        const publication = await publicationRepository.getPublicationByFolder(
          input.folderId,
        );
        return {
          kind: "partial",
          folderId: input.folderId,
          mainMessageId: input.mainMessageId,
          pending: "thread",
          publication: publication!,
          attempt: null,
          errorCode: mapPersistenceError(error),
          retryable: false,
        };
      }
      throw error;
    }

    if (threadReserve.kind === "idempotent_hit") {
      const pub = threadReserve.publication;
      if (pub.threadId != null && pub.status === "main_published") {
        return {
          kind: "succeeded",
          folderId: input.folderId,
          mainMessageId: input.mainMessageId,
          threadId: pub.threadId,
          publication: pub,
          attempt: threadReserve.attempt,
          channelRole: input.channelRole,
        };
      }
      if (
        threadReserve.attempt.status === "succeeded" &&
        threadReserve.attempt.discordThreadId != null
      ) {
        return {
          kind: "succeeded",
          folderId: input.folderId,
          mainMessageId: input.mainMessageId,
          threadId: threadReserve.attempt.discordThreadId,
          publication: pub,
          attempt: threadReserve.attempt,
          channelRole: input.channelRole,
        };
      }
      // already_reserved — fall through and call Discord again under same key
    }

    const threadAttemptId =
      threadReserve.kind === "reserved"
        ? threadReserve.attempt.id
        : threadReserve.attempt.id;

    const threadClaimed = await claimDiscordExecution(threadAttemptId);
    if (threadClaimed === null) {
      return {
        kind: "partial" as const,
        folderId: input.folderId,
        mainMessageId: input.mainMessageId,
        pending: "thread" as const,
        publication: threadReserve.publication,
        attempt: threadReserve.attempt,
        errorCode: "hold" as const,
        retryable: true,
      };
    }

    try {
      const { threadId } = await discord.startThread({
        channelId: input.channelId,
        messageId: input.mainMessageId,
        name: input.threadName,
        autoArchiveMinutes: PUBLICATION_THREAD_AUTO_ARCHIVE_MINUTES,
      });

      try {
        const persisted = await publicationRepository.recordThreadCreated({
          folderId: input.folderId,
          threadId,
          attemptId: threadAttemptId,
          durationMs: Math.max(0, now().getTime() - input.startedAt),
        });
        await releaseDiscordExecution(threadAttemptId);

        return {
          kind: "succeeded",
          folderId: input.folderId,
          mainMessageId: input.mainMessageId,
          threadId,
          publication: persisted.publication,
          attempt: persisted.attempt,
          channelRole: input.channelRole,
        };
      } catch {
        await releaseDiscordExecution(threadAttemptId);
        const publication =
          await publicationRepository.getPublicationByFolder(input.folderId);
        return {
          kind: "partial",
          folderId: input.folderId,
          mainMessageId: input.mainMessageId,
          pending: "thread",
          publication: publication!,
          attempt: null,
          errorCode: "persist_failed",
          retryable: false,
        };
      }
    } catch (error) {
      await releaseDiscordExecution(threadAttemptId);
      const mapped = mapPortError(error);
      const recorded = await recordPortFailure({
        folderId: input.folderId,
        attemptId: threadAttemptId,
        code: mapped.code,
        retryable: mapped.retryable,
        markFolderFailed: false,
        startedAt: input.startedAt,
      });
      const publication =
        recorded.publication ??
        (await publicationRepository.getPublicationByFolder(input.folderId));
      return {
        kind: "partial",
        folderId: input.folderId,
        mainMessageId: input.mainMessageId,
        pending: "thread",
        publication: publication!,
        attempt: recorded.attempt,
        errorCode: mapped.code,
        retryable: mapped.retryable,
      };
    }
  }

  async function runPublish(
    input: PublicationOrchestrationInput,
    folder: { id: string; title: string; lastActivityAt: Date },
  ): Promise<PublicationOrchestrationResult> {
    const startedAt = now().getTime();
    const folderId = input.folderId;

    if (
      input.analysisAttemptId === null ||
      input.analysisAttemptId.trim() === ""
    ) {
      return failed({
        folderId,
        error: "precondition_failed",
        retryable: false,
      });
    }

    if (!isPublishableHint(input.channelHint)) {
      return failed({
        folderId,
        error:
          input.channelHint === "none" || input.channelHint === null
            ? "channel_unmapped"
            : "precondition_failed",
        retryable: false,
      });
    }

    const channelRole: PublicationChannelRole =
      CHANNEL_HINT_TO_ROLE[input.channelHint];
    const channelId = resolveChannelId(input.channelHint);
    if (channelId === null || channelId.trim() === "") {
      return failed({
        folderId,
        error: "channel_unmapped",
        retryable: false,
      });
    }

    if (
      input.validatedContent === undefined ||
      input.validatedContent === null
    ) {
      return failed({
        folderId,
        error: "precondition_failed",
        retryable: false,
      });
    }

    const existing = await publicationRepository.getPublicationByFolder(
      folderId,
    );
    if (existing?.hasMainPublication === true) {
      return skipped({
        reason: "idempotent_hit",
        folderId,
        publication: existing,
        errorCode: "idempotent_hit",
      });
    }

    // Reprise: partial with main message → create_thread only
    if (
      existing !== null &&
      existing.status === "partial" &&
      existing.mainMessageId !== null &&
      existing.channelId !== null
    ) {
      let built: BuildMainPublicationContentResult;
      try {
        built = builders.buildMain({
          folderId,
          title: folder.title,
          channelRole,
          content: input.validatedContent,
          sources: input.sources ?? [],
          usefulDate: input.usefulDate ?? folder.lastActivityAt,
        });
      } catch (error) {
        if (error instanceof PublicationContentError) {
          return failed({
            folderId,
            error: "precondition_failed",
            retryable: false,
            publication: existing,
          });
        }
        throw error;
      }

      return completeThread({
        folderId,
        channelId: existing.channelId,
        mainMessageId: existing.mainMessageId,
        threadName: built.threadName,
        channelRole,
        startedAt,
      });
    }

    let built: BuildMainPublicationContentResult;
    try {
      built = builders.buildMain({
        folderId,
        title: folder.title,
        channelRole,
        content: input.validatedContent,
        sources: input.sources ?? [],
        usefulDate: input.usefulDate ?? folder.lastActivityAt,
      });
    } catch (error) {
      if (error instanceof PublicationContentError) {
        return failed({
          folderId,
          error: "precondition_failed",
          retryable: false,
        });
      }
      throw error;
    }

    let reserve;
    try {
      reserve = await publicationRepository.reservePublish({
        folderId,
        guildId,
        analysisAttemptId: input.analysisAttemptId,
        idempotencyKey: buildPublishIdempotencyKey(folderId),
      });
    } catch (error) {
      if (error instanceof PublicationPersistenceError) {
        if (error.code === "folder_closed") {
          return skipped({
            reason: "folder_closed",
            folderId,
            errorCode: "folder_closed",
          });
        }
        return failed({
          folderId,
          error: mapPersistenceError(error),
          retryable: false,
        });
      }
      throw error;
    }

    if (reserve.kind === "idempotent_hit") {
      const pub = reserve.publication;
      if (
        pub.hasMainPublication &&
        pub.mainMessageId != null &&
        pub.threadId != null
      ) {
        return skipped({
          reason: "idempotent_hit",
          folderId,
          publication: pub,
          attempt: reserve.attempt,
          errorCode: "idempotent_hit",
        });
      }
      if (
        pub.status === "partial" &&
        pub.mainMessageId != null &&
        pub.channelId != null
      ) {
        return completeThread({
          folderId,
          channelId: pub.channelId,
          mainMessageId: pub.mainMessageId,
          threadName: built.threadName,
          channelRole,
          startedAt,
        });
      }
      // already_reserved without Discord IDs — continue under same attempt
      if (reserve.attempt.status === "reserved" && pub.mainMessageId === null) {
        // fall through with this attempt
      } else if (reserve.reason === "already_published") {
        return skipped({
          reason: "idempotent_hit",
          folderId,
          publication: pub,
          attempt: reserve.attempt,
          errorCode: "idempotent_hit",
        });
      }
    }

    const attempt =
      reserve.kind === "reserved" ? reserve.attempt : reserve.attempt;
    const publicationAfterReserve = reserve.publication;

    const claimed = await claimDiscordExecution(attempt.id);
    if (claimed === null) {
      return skipped({
        reason: "idempotent_hit",
        folderId,
        publication: publicationAfterReserve,
        attempt,
        errorCode: "hold",
      });
    }

    let messageId: string;
    try {
      const sent = await discord.sendMainMessage({
        channelId,
        content: built.payload,
      });
      messageId = sent.messageId;
    } catch (error) {
      await releaseDiscordExecution(attempt.id);
      const mapped = mapPortError(error);
      const recorded = await recordPortFailure({
        folderId,
        attemptId: attempt.id,
        code: mapped.code,
        retryable: mapped.retryable,
        markFolderFailed: true,
        startedAt,
      });
      return failed({
        folderId,
        error: mapped.code,
        retryable: mapped.retryable,
        publication: recorded.publication ?? publicationAfterReserve,
        attempt: recorded.attempt ?? attempt,
      });
    }

    await releaseDiscordExecution(attempt.id);

    let publicationAfterMain: FolderPublicationRecord;
    try {
      const persisted = await publicationRepository.recordMainPublicationSuccess(
        {
          folderId,
          guildId,
          channelId,
          mainMessageId: messageId,
          threadId: null,
          analysisAttemptId: input.analysisAttemptId,
          attemptId: attempt.id,
          durationMs: Math.max(0, now().getTime() - startedAt),
        },
      );
      publicationAfterMain = persisted.publication;
    } catch {
      return {
        kind: "partial",
        folderId,
        mainMessageId: messageId,
        pending: "thread",
        publication: {
          ...publicationAfterReserve,
          channelId,
          mainMessageId: messageId,
          status: "partial",
          hasMainPublication: true,
        },
        attempt,
        errorCode: "persist_failed",
        retryable: false,
      };
    }

    return completeThread({
      folderId,
      channelId,
      mainMessageId: messageId,
      threadName: built.threadName,
      channelRole,
      startedAt,
    });
  }

  async function ensureThreadForEnrich(input: {
    folderId: string;
    publication: FolderPublicationRecord;
    threadName: string;
    startedAt: number;
  }): Promise<
    | { ok: true; publication: FolderPublicationRecord; threadId: string }
    | { ok: false; result: PublicationOrchestrationResult }
  > {
    const { publication } = input;
    if (publication.threadId != null) {
      return {
        ok: true,
        publication,
        threadId: publication.threadId,
      };
    }
    if (
      publication.status !== "partial" ||
      publication.mainMessageId === null ||
      publication.channelId === null
    ) {
      return {
        ok: false,
        result: failed({
          folderId: input.folderId,
          error: "precondition_failed",
          retryable: false,
          publication,
        }),
      };
    }

    const threadResult = await completeThread({
      folderId: input.folderId,
      channelId: publication.channelId,
      mainMessageId: publication.mainMessageId,
      threadName: input.threadName,
      channelRole: "VEILLE_PERTINENTE",
      startedAt: input.startedAt,
    });

    if (threadResult.kind === "succeeded") {
      return {
        ok: true,
        publication: threadResult.publication,
        threadId: threadResult.threadId,
      };
    }
    return { ok: false, result: threadResult };
  }

  async function runEnrich(
    input: PublicationOrchestrationInput,
    folder: { id: string; title: string },
  ): Promise<PublicationOrchestrationResult> {
    const startedAt = now().getTime();
    const folderId = input.folderId;

    if (
      input.analysisAttemptId === null ||
      input.analysisAttemptId.trim() === ""
    ) {
      return failed({
        folderId,
        error: "precondition_failed",
        retryable: false,
      });
    }
    if (
      input.aggregateFingerprint === null ||
      input.aggregateFingerprint.trim() === ""
    ) {
      return failed({
        folderId,
        error: "precondition_failed",
        retryable: false,
      });
    }

    const publication = await publicationRepository.getPublicationByFolder(
      folderId,
    );
    if (publication === null || !publication.hasMainPublication) {
      return failed({
        folderId,
        error: "precondition_failed",
        retryable: false,
        publication,
      });
    }
    if (publication.status === "inconsistent") {
      return failed({
        folderId,
        error: "inconsistent_state",
        retryable: false,
        publication,
      });
    }

    let built: BuildEnrichmentPublicationContentResult;
    try {
      built = builders.buildEnrichment({
        folderId,
        newFacts: input.newFacts ?? [],
        newSources: input.newSources ?? [],
        aggregateFingerprint: input.aggregateFingerprint,
      });
    } catch (error) {
      if (error instanceof PublicationContentError) {
        return failed({
          folderId,
          error: "precondition_failed",
          retryable: false,
          publication,
        });
      }
      throw error;
    }

    // Ensure thread exists (partial → create_thread first)
    const threadName = `Veille — ${folder.title}`.slice(0, 100);
    const ensured = await ensureThreadForEnrich({
      folderId,
      publication,
      threadName,
      startedAt,
    });
    if (!ensured.ok) {
      return ensured.result;
    }

    const enrichKey = buildEnrichIdempotencyKey(
      folderId,
      input.aggregateFingerprint,
      input.analysisAttemptId,
    );

    let reserve;
    try {
      reserve = await publicationRepository.reserveOperation({
        folderId,
        kind: "enrich",
        idempotencyKey: enrichKey,
        analysisAttemptId: input.analysisAttemptId,
        eventFingerprint: input.aggregateFingerprint,
      });
    } catch (error) {
      if (error instanceof PublicationPersistenceError) {
        return failed({
          folderId,
          error: mapPersistenceError(error),
          retryable: false,
          publication: ensured.publication,
        });
      }
      throw error;
    }

    if (reserve.kind === "idempotent_hit") {
      if (
        reserve.attempt.status === "succeeded" &&
        reserve.attempt.discordMessageId != null
      ) {
        return skipped({
          reason: "idempotent_hit",
          folderId,
          publication: reserve.publication,
          attempt: reserve.attempt,
          errorCode: "idempotent_hit",
        });
      }
      // already_reserved — retry Discord under same attempt
    }

    const attempt = reserve.attempt;
    const threadId = ensured.threadId;

    const enrichClaimed = await claimDiscordExecution(attempt.id);
    if (enrichClaimed === null) {
      return skipped({
        reason: "idempotent_hit",
        folderId,
        publication: ensured.publication,
        attempt,
        errorCode: "hold",
      });
    }

    try {
      await discord.unarchiveThreadIfNeeded({ threadId });
    } catch (error) {
      await releaseDiscordExecution(attempt.id);
      const mapped = mapPortError(error);
      const code: PublicationErrorCode =
        mapped.code === "unknown" ? "inconsistent_state" : mapped.code;
      const recorded = await recordPortFailure({
        folderId,
        attemptId: attempt.id,
        code,
        retryable: isRetryablePortCode(code),
        markFolderFailed: false,
        startedAt,
      });
      return failed({
        folderId,
        error: code,
        retryable: isRetryablePortCode(code),
        publication: recorded.publication ?? ensured.publication,
        attempt: recorded.attempt ?? attempt,
      });
    }

    let threadMessageId: string;
    try {
      const sent = await discord.sendThreadMessage({
        threadId,
        content: built.payload,
      });
      threadMessageId = sent.messageId;
    } catch (error) {
      await releaseDiscordExecution(attempt.id);
      const mapped = mapPortError(error);
      const recorded = await recordPortFailure({
        folderId,
        attemptId: attempt.id,
        code: mapped.code,
        retryable: mapped.retryable,
        markFolderFailed: false,
        startedAt,
      });
      return failed({
        folderId,
        error: mapped.code,
        retryable: mapped.retryable,
        publication: recorded.publication ?? ensured.publication,
        attempt: recorded.attempt ?? attempt,
      });
    }

    try {
      const persisted = await publicationRepository.recordEnrichmentPublished({
        folderId,
        discordMessageId: threadMessageId,
        attemptId: attempt.id,
        durationMs: Math.max(0, now().getTime() - startedAt),
      });
      return {
        kind: "enriched",
        folderId,
        threadMessageId,
        publication: persisted.publication,
        attempt: persisted.attempt,
      };
    } catch {
      return failed({
        folderId,
        error: "persist_failed",
        retryable: false,
        publication: ensured.publication,
        attempt,
      });
    }
  }

  async function resumePartial(
    folderId: string,
  ): Promise<PublicationOrchestrationResult> {
    const startedAt = now().getTime();
    const loaded = await loadFolderOrFail(folderId);
    if (!loaded.ok) {
      return loaded.result;
    }

    const publication =
      await publicationRepository.getPublicationByFolder(folderId);
    if (publication === null) {
      return failed({
        folderId,
        error: "precondition_failed",
        retryable: false,
      });
    }

    if (
      publication.status === "partial" &&
      publication.mainMessageId != null &&
      publication.channelId != null
    ) {
      const threadName = `Veille — ${loaded.folder.title}`.slice(0, 100);
      return completeThread({
        folderId,
        channelId: publication.channelId,
        mainMessageId: publication.mainMessageId,
        threadName,
        channelRole: "VEILLE_PERTINENTE",
        startedAt,
      });
    }

    if (publication.status === "pending") {
      return failed({
        folderId,
        error: "precondition_failed",
        retryable: false,
        publication,
      });
    }

    if (
      publication.status === "main_published" &&
      publication.mainMessageId != null &&
      publication.threadId != null
    ) {
      return skipped({
        reason: "idempotent_hit",
        folderId,
        publication,
        errorCode: "idempotent_hit",
      });
    }

    return failed({
      folderId,
      error: "precondition_failed",
      retryable: false,
      publication,
    });
  }

  return {
    async process(input) {
      const folderId = requireNonEmpty(input.folderId, "folderId");
      const decisionMethod = input.decisionMethod ?? "llm_analysis";
      logPublication("publication.attempt", {
        publicationId: null,
        dossierId: folderId,
        channelHint: input.channelHint,
        decisionMethod,
        attemptNumber: 1,
        decision: input.decision,
      });

      switch (input.decision) {
        case "hold":
          logPublication("publication.skipped_duplicate", {
            dossierId: folderId,
            reason: "hold",
            decisionMethod,
          });
          return skipped({ reason: "hold", folderId, errorCode: "hold" });
        case "reject_editorial":
          logPublication("publication.skipped_duplicate", {
            dossierId: folderId,
            reason: "reject_editorial",
            decisionMethod,
          });
          return skipped({
            reason: "reject_editorial",
            folderId,
            errorCode: "reject_editorial",
          });
        case "publish":
        case "enrich_thread_only":
          break;
        default: {
          const _exhaustive: never = input.decision;
          throw new PublicationOrchestrationError(
            `Unsupported publication decision: ${JSON.stringify(_exhaustive)}`,
          );
        }
      }

      const loaded = await loadFolderOrFail(folderId);
      if (!loaded.ok) {
        logPublication("publication.failed_terminal", {
          dossierId: folderId,
          error: loaded.result.kind === "failed" ? loaded.result.error : "unknown",
          decisionMethod,
        });
        return loaded.result;
      }

      const result =
        input.decision === "publish"
          ? await runPublish(input, loaded.folder)
          : await runEnrich(input, loaded.folder);

      if (result.kind === "succeeded" || result.kind === "enriched") {
        logPublication("publication.succeeded", {
          publicationId: result.publication.id,
          dossierId: folderId,
          decisionMethod,
          kind: result.kind,
        });
      } else if (result.kind === "partial") {
        logPublication("publication.retry_scheduled", {
          publicationId: result.publication.id,
          dossierId: folderId,
          decisionMethod,
          retryable: result.retryable,
          errorCode: result.errorCode,
        });
      } else if (result.kind === "failed") {
        logPublication(
          result.retryable
            ? "publication.retry_scheduled"
            : "publication.failed_terminal",
          {
            publicationId: result.publication?.id ?? null,
            dossierId: folderId,
            decisionMethod,
            error: result.error,
            retryable: result.retryable,
          },
        );
      } else if (result.kind === "skipped") {
        logPublication("publication.skipped_duplicate", {
          publicationId: result.publication?.id ?? null,
          dossierId: folderId,
          decisionMethod,
          reason: result.reason,
        });
      }

      return result;
    },

    async resume(folderId) {
      return resumePartial(requireNonEmpty(folderId, "folderId"));
    },
  };
}
