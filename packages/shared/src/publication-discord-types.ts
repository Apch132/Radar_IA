/**
 * Public contracts for Discord publication content construction (008.1C).
 * Abstract of discord.js — compatible with a future bot port.
 */

/** Business channel roles for publication V1 (gel 008.1A §7.1). No Discord IDs. */
export const PUBLICATION_CHANNEL_ROLES = [
  "ANNONCES_MAJEURES",
  "VEILLE_PERTINENTE",
  "FLUX_IA",
] as const;

export type PublicationChannelRole =
  (typeof PUBLICATION_CHANNEL_ROLES)[number];

/** channelHint values from 007 that map to a business salon. */
export type PublicationChannelHint =
  | "annonces_majeures"
  | "veille_pertinente"
  | "flux_ia";

export const CHANNEL_HINT_TO_ROLE: Readonly<
  Record<PublicationChannelHint, PublicationChannelRole>
> = {
  annonces_majeures: "ANNONCES_MAJEURES",
  veille_pertinente: "VEILLE_PERTINENTE",
  flux_ia: "FLUX_IA",
};

export const ROLE_TO_CHANNEL_HINT: Readonly<
  Record<PublicationChannelRole, PublicationChannelHint>
> = {
  ANNONCES_MAJEURES: "annonces_majeures",
  VEILLE_PERTINENTE: "veille_pertinente",
  FLUX_IA: "flux_ia",
};

/** Validated editorial content already accepted by 007. */
export interface PublicationValidatedContent {
  readonly summary: string;
  readonly primaryCategory: string;
  readonly publishWorthiness: string;
  readonly composite: number;
}

/** Source candidate for display (URLs already normalized upstream when present). */
export interface PublicationSourceInput {
  readonly name: string;
  readonly url?: string | null;
}

/** Anchored enrichment fact from 006/007. */
export interface PublicationEnrichmentFactInput {
  readonly key: string;
  readonly value: string;
}

/** Input for main publication content construction. */
export interface BuildMainPublicationContentInput {
  readonly folderId: string;
  readonly title: string;
  readonly channelRole: PublicationChannelRole;
  readonly content: PublicationValidatedContent;
  readonly sources: readonly PublicationSourceInput[];
  /**
   * Useful date (primary article publishedAt or folder lastActivityAt).
   * Formatted as UTC `YYYY-MM-DD`. Accepts ISO string or Date.
   */
  readonly usefulDate: string | Date;
}

/** Input for thread enrichment content construction. */
export interface BuildEnrichmentPublicationContentInput {
  readonly folderId: string;
  readonly newFacts: readonly PublicationEnrichmentFactInput[];
  readonly newSources: readonly PublicationSourceInput[];
  /** Optional short fingerprint fragment for footer (not an internal secret). */
  readonly aggregateFingerprint?: string | null;
}

/** Abstract Discord embed field (no discord.js types). */
export interface DiscordEmbedFieldPayload {
  readonly name: string;
  readonly value: string;
  readonly inline?: boolean;
}

/** Abstract Discord embed. */
export interface DiscordEmbedPayload {
  readonly title?: string;
  readonly description?: string;
  readonly url?: string;
  readonly fields?: readonly DiscordEmbedFieldPayload[];
  readonly footer?: { readonly text: string };
}

/**
 * Rendered Discord payload for the future bot port.
 * Compatible with sendMainMessage / sendThreadMessage conceptual shapes.
 */
export interface RenderedDiscordPayload {
  readonly content: string;
  readonly embeds: readonly DiscordEmbedPayload[];
}

export type PublicationRenderWarningCode =
  | "title_truncated"
  | "summary_truncated"
  | "message_truncated"
  | "source_ignored"
  | "url_invalid"
  | "field_omitted"
  | "thread_name_truncated"
  | "empty_fallback"
  | "embed_total_truncated"
  | "field_value_truncated"
  | "field_name_truncated";

export interface PublicationRenderWarning {
  readonly code: PublicationRenderWarningCode;
  readonly detail?: string;
}

export interface TruncationResult {
  readonly text: string;
  readonly truncated: boolean;
}

export interface BuildMainPublicationContentResult {
  readonly payload: RenderedDiscordPayload;
  readonly threadName: string;
  readonly channelRole: PublicationChannelRole;
  readonly warnings: readonly PublicationRenderWarning[];
}

export interface BuildEnrichmentPublicationContentResult {
  readonly payload: RenderedDiscordPayload;
  readonly warnings: readonly PublicationRenderWarning[];
}

/**
 * Raised only when no valid Discord payload can be produced
 * (truncation alone is never a terminal error).
 */
export class PublicationContentError extends Error {
  readonly code = "content_unbuildable" as const;

  constructor(message: string) {
    super(message);
    this.name = "PublicationContentError";
  }
}
