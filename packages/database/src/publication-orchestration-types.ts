import type {
  PublicationChannelHint,
  PublicationChannelRole,
  PublicationEnrichmentFactInput,
  PublicationSourceInput,
  PublicationValidatedContent,
  RenderedDiscordPayload,
} from "@radar-ia/shared";

import type {
  FolderPublicationRecord,
  PublicationAttemptRecord,
  PublicationErrorCode,
} from "./publication-types.js";

/** Décisions 007 consommées par l’orchestrateur 008 (gel 008.1A §6). */
export type PublicationOrchestrationDecision =
  | "publish"
  | "enrich_thread_only"
  | "hold"
  | "reject_editorial";

/** Hint salon 007 — y compris `none` (pas de publish). */
export type PublicationOrchestrationChannelHint =
  | PublicationChannelHint
  | "none";

/**
 * Contenu éditorial déjà validé (007) pour le rendu Discord (008.1C).
 * Pas de ré-inférence LLM dans 008.
 */
export interface PublicationOrchestrationValidatedContent
  extends PublicationValidatedContent {}

/** Entrée d’orchestration (gel 008.1A §5.1 / §19). */
export interface PublicationOrchestrationInput {
  readonly folderId: string;
  readonly decision: PublicationOrchestrationDecision;
  /**
   * Tentative 007 liée. Obligatoire pour `publish` / `enrich_thread_only`.
   */
  readonly analysisAttemptId: string | null;
  /** Obligatoire pour `publish` (≠ `none`). */
  readonly channelHint: PublicationOrchestrationChannelHint | null;
  /** Obligatoire pour `enrich_thread_only`. */
  readonly aggregateFingerprint: string | null;
  /** Contenu validé — requis pour publish / enrich. */
  readonly validatedContent?: PublicationOrchestrationValidatedContent | null;
  /** Sources affichables (publish) — URLs déjà normalisées amont. */
  readonly sources?: readonly PublicationSourceInput[];
  /** Faits d’enrichissement nouveaux (enrich). */
  readonly newFacts?: readonly PublicationEnrichmentFactInput[];
  /** Nouvelles sources (enrich). */
  readonly newSources?: readonly PublicationSourceInput[];
  /**
   * Date utile (article primary `publishedAt` ou `lastActivityAt`).
   * Défaut : `folder.lastActivityAt` si omise.
   */
  readonly usefulDate?: string | Date;
  /** Decision method for structured publication logs. */
  readonly decisionMethod?: "llm_analysis" | "deterministic_fallback";
}

export type PublicationOrchestrationSkipReason =
  | "hold"
  | "reject_editorial"
  | "idempotent_hit"
  | "folder_closed";

/**
 * Résultat déterministe d’une commande de publication (gel 008.1A §19).
 */
export type PublicationOrchestrationResult =
  | {
      readonly kind: "skipped";
      readonly reason: PublicationOrchestrationSkipReason;
      readonly folderId: string;
      readonly publication: FolderPublicationRecord | null;
      readonly attempt: PublicationAttemptRecord | null;
      readonly errorCode: PublicationErrorCode | null;
    }
  | {
      readonly kind: "succeeded";
      readonly folderId: string;
      readonly mainMessageId: string;
      readonly threadId: string;
      readonly publication: FolderPublicationRecord;
      readonly attempt: PublicationAttemptRecord | null;
      readonly channelRole: PublicationChannelRole;
    }
  | {
      readonly kind: "enriched";
      readonly folderId: string;
      readonly threadMessageId: string;
      readonly publication: FolderPublicationRecord;
      readonly attempt: PublicationAttemptRecord | null;
    }
  | {
      readonly kind: "partial";
      readonly folderId: string;
      readonly mainMessageId: string;
      readonly pending: "thread";
      readonly publication: FolderPublicationRecord;
      readonly attempt: PublicationAttemptRecord | null;
      readonly errorCode: PublicationErrorCode | null;
      readonly retryable: boolean;
    }
  | {
      readonly kind: "failed";
      readonly folderId: string;
      readonly error: PublicationErrorCode;
      readonly retryable: boolean;
      readonly publication: FolderPublicationRecord | null;
      readonly attempt: PublicationAttemptRecord | null;
    };

/** Codes d’erreur exposés par le port Discord (sous-ensemble gel §11.3). */
export type DiscordPublicationPortErrorCode = Extract<
  PublicationErrorCode,
  | "channel_unavailable"
  | "missing_permission"
  | "discord_rate_limited"
  | "discord_timeout"
  | "discord_unavailable"
  | "inconsistent_state"
  | "unknown"
>;

/**
 * Erreur typée levée par une implémentation du port Discord.
 * L’orchestrateur mappe vers `failed` / `partial` / `inconsistent` — jamais de discord.js ici.
 */
export class DiscordPublicationPortError extends Error {
  readonly code: DiscordPublicationPortErrorCode;
  readonly retryable: boolean;

  constructor(
    code: DiscordPublicationPortErrorCode,
    message: string,
    options: { retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "DiscordPublicationPortError";
    this.code = code;
    this.retryable =
      options.retryable ??
      (code === "discord_rate_limited" ||
        code === "discord_timeout" ||
        code === "discord_unavailable" ||
        code === "channel_unavailable");
  }
}

/**
 * Port Discord injectable (gel 008.1A §19).
 * Interface uniquement — implémentation discord.js dans `@radar-ia/bot` (hors 008.1D).
 */
export interface DiscordPublicationPort {
  sendMainMessage(input: {
    channelId: string;
    content: RenderedDiscordPayload;
  }): Promise<{ messageId: string }>;

  startThread(input: {
    channelId: string;
    messageId: string;
    name: string;
    autoArchiveMinutes: 1440;
  }): Promise<{ threadId: string }>;

  unarchiveThreadIfNeeded(input: { threadId: string }): Promise<void>;

  sendThreadMessage(input: {
    threadId: string;
    content: RenderedDiscordPayload;
  }): Promise<{ messageId: string }>;

  fetchMessage?(input: {
    channelId: string;
    messageId: string;
  }): Promise<{ exists: boolean }>;
}

/**
 * Résout un hint salon métier → snowflake Discord.
 * Mapping config only — aucun fallback (gel §7.2).
 */
export type PublicationChannelResolver = (
  hint: PublicationChannelHint,
) => string | null;

/**
 * Raised for contract / wiring violations (not business skip/fail results).
 */
export class PublicationOrchestrationError extends Error {
  readonly code = "PUBLICATION_ORCHESTRATION";

  constructor(message: string) {
    super(message);
    this.name = "PublicationOrchestrationError";
  }
}

/** Archivage fil figé (gel 008.1A §8.4 / P08). */
export const PUBLICATION_THREAD_AUTO_ARCHIVE_MINUTES = 1440 as const;
