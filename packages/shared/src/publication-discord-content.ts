import { DISCORD_LIMITS } from "./publication-discord-limits.js";
import {
  acceptHttpUrl,
  normalizeWhitespace,
  sanitizeDiscordText,
  unicodeLength,
} from "./publication-discord-sanitize.js";
import {
  embedCharacterCount,
  truncateDiscordText,
  truncateEmbedDescription,
  truncateEmbedFieldName,
  truncateEmbedFieldValue,
  truncateEmbedFooter,
  truncateEmbedTitle,
  truncateMessageContent,
  truncateThreadName,
} from "./publication-discord-truncate.js";
import type {
  BuildEnrichmentPublicationContentInput,
  BuildEnrichmentPublicationContentResult,
  BuildMainPublicationContentInput,
  BuildMainPublicationContentResult,
  DiscordEmbedFieldPayload,
  DiscordEmbedPayload,
  PublicationRenderWarning,
  PublicationSourceInput,
} from "./publication-discord-types.js";
import { PublicationContentError } from "./publication-discord-types.js";

const THREAD_NAME_PREFIX = "Veille — ";
const FALLBACK_TITLE = "Veille IA";
const FALLBACK_SUMMARY = "Résumé indisponible.";
const SOURCES_FIELD_NAME = "Sources";
const CATEGORY_FIELD_NAME = "Catégorie";
const PERTINENCE_FIELD_NAME = "Pertinence";
const DATE_FIELD_NAME = "Date";

const PUBLICATION_CHANNEL_ROLES_SET: ReadonlySet<string> = new Set([
  "ANNONCES_MAJEURES",
  "VEILLE_PERTINENTE",
  "FLUX_IA",
]);

function folderFooterSuffix(folderId: string): string {
  const id = folderId.trim();
  const suffix = id.length <= 8 ? id : id.slice(-8);
  return `dossier:${suffix}`;
}

/**
 * Format a useful date as UTC `YYYY-MM-DD`.
 * No system locale dependency.
 */
export function formatUsefulDateUtc(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  const y = date.getUTCFullYear().toString().padStart(4, "0");
  const m = (date.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = date.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

interface PreparedSource {
  readonly name: string;
  readonly url: string | null;
}

function compareSources(a: PreparedSource, b: PreparedSource): number {
  const byName = a.name.localeCompare(b.name, "en");
  if (byName !== 0) return byName;
  const urlA = a.url ?? "";
  const urlB = b.url ?? "";
  return urlA.localeCompare(urlB, "en");
}

/**
 * Sanitize, validate URLs, dedupe, sort — deterministic.
 */
export function preparePublicationSources(
  sources: readonly PublicationSourceInput[],
  warnings: PublicationRenderWarning[],
): PreparedSource[] {
  const prepared: PreparedSource[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    const name = sanitizeDiscordText(source.name ?? "");
    if (name.length === 0) {
      warnings.push({
        code: "source_ignored",
        detail: "empty_name",
      });
      continue;
    }

    let url: string | null = null;
    if (source.url != null && String(source.url).trim().length > 0) {
      url = acceptHttpUrl(source.url);
      if (url === null) {
        warnings.push({
          code: "url_invalid",
          detail: String(source.url).slice(0, 120),
        });
      }
    }

    const dedupeKey = `${name.toLowerCase()}|${url ?? ""}`;
    if (seen.has(dedupeKey)) {
      warnings.push({
        code: "source_ignored",
        detail: "duplicate",
      });
      continue;
    }
    seen.add(dedupeKey);
    prepared.push({ name, url });
  }

  prepared.sort(compareSources);
  return prepared;
}

function formatSourcesFieldValue(
  sources: readonly PreparedSource[],
  warnings: PublicationRenderWarning[],
): string | null {
  if (sources.length === 0) {
    return null;
  }
  const limited = sources.slice(0, DISCORD_LIMITS.SOURCES_DISPLAY_MAX);
  if (sources.length > DISCORD_LIMITS.SOURCES_DISPLAY_MAX) {
    warnings.push({
      code: "source_ignored",
      detail: `capped_at_${DISCORD_LIMITS.SOURCES_DISPLAY_MAX}`,
    });
  }
  const lines = limited.map((s) =>
    s.url !== null ? `${s.name} — ${s.url}` : s.name,
  );
  const raw = lines.join("\n");
  const truncated = truncateEmbedFieldValue(raw);
  if (truncated.truncated) {
    warnings.push({ code: "field_value_truncated", detail: SOURCES_FIELD_NAME });
  }
  return truncated.text.length > 0 ? truncated.text : null;
}

function pushField(
  fields: DiscordEmbedFieldPayload[],
  warnings: PublicationRenderWarning[],
  name: string,
  value: string,
  inline = true,
): void {
  if (fields.length >= DISCORD_LIMITS.EMBED_FIELDS_MAX) {
    warnings.push({ code: "field_omitted", detail: name });
    return;
  }
  const nameResult = truncateEmbedFieldName(name);
  if (nameResult.truncated) {
    warnings.push({ code: "field_name_truncated", detail: name });
  }
  const valueResult = truncateEmbedFieldValue(value);
  if (valueResult.truncated) {
    warnings.push({ code: "field_value_truncated", detail: name });
  }
  if (nameResult.text.length === 0 || valueResult.text.length === 0) {
    warnings.push({ code: "field_omitted", detail: name });
    return;
  }
  fields.push({
    name: nameResult.text,
    value: valueResult.text,
    inline,
  });
}

/**
 * Shrink embed description (then fields from the end) until total ≤ EMBED_TOTAL.
 */
function enforceEmbedTotal(
  embed: DiscordEmbedPayload,
  warnings: PublicationRenderWarning[],
): DiscordEmbedPayload {
  let title = embed.title;
  let description = embed.description;
  let fields = [...(embed.fields ?? [])];
  let footer = embed.footer;

  const measure = (): number =>
    embedCharacterCount({ title, description, fields, footer });

  if (measure() <= DISCORD_LIMITS.EMBED_TOTAL) {
    return embed;
  }

  // Shrink description first
  if (description) {
    const budget =
      DISCORD_LIMITS.EMBED_TOTAL -
      embedCharacterCount({ title, fields, footer });
    if (budget <= 0) {
      description = undefined;
      warnings.push({ code: "embed_total_truncated", detail: "description_removed" });
    } else if (unicodeLength(description) > budget) {
      const t = truncateDiscordText(description, budget);
      description = t.text;
      warnings.push({ code: "embed_total_truncated", detail: "description" });
    }
  }

  // Drop fields from the end until under budget
  while (measure() > DISCORD_LIMITS.EMBED_TOTAL && fields.length > 0) {
    const removed = fields.pop();
    warnings.push({
      code: "field_omitted",
      detail: removed?.name ?? "unknown",
    });
    warnings.push({ code: "embed_total_truncated", detail: "field_dropped" });
  }

  // Last resort: shrink title
  if (measure() > DISCORD_LIMITS.EMBED_TOTAL && title) {
    const budget =
      DISCORD_LIMITS.EMBED_TOTAL -
      embedCharacterCount({ description, fields, footer });
    if (budget <= 0) {
      title = undefined;
      warnings.push({ code: "embed_total_truncated", detail: "title_removed" });
    } else {
      const t = truncateDiscordText(title, budget);
      title = t.text;
      warnings.push({ code: "embed_total_truncated", detail: "title" });
    }
  }

  // Footer shrink
  if (measure() > DISCORD_LIMITS.EMBED_TOTAL && footer) {
    const budget =
      DISCORD_LIMITS.EMBED_TOTAL -
      embedCharacterCount({ title, description, fields });
    if (budget <= 0) {
      footer = undefined;
      warnings.push({ code: "embed_total_truncated", detail: "footer_removed" });
    } else {
      const t = truncateEmbedFooter(
        truncateDiscordText(footer.text, budget).text,
      );
      footer = { text: t.text };
      warnings.push({ code: "embed_total_truncated", detail: "footer" });
    }
  }

  return {
    ...embed,
    title,
    description,
    fields: fields.length > 0 ? fields : undefined,
    footer,
  };
}

/**
 * Pure thread name builder: `Veille — {title}`.
 */
export function buildThreadName(
  title: string,
  warnings?: PublicationRenderWarning[],
): string {
  const cleaned = sanitizeDiscordText(title);
  const base =
    cleaned.length > 0 ? cleaned : FALLBACK_TITLE;
  if (cleaned.length === 0 && warnings) {
    warnings.push({ code: "empty_fallback", detail: "thread_title" });
  }
  const full = `${THREAD_NAME_PREFIX}${base}`;
  const truncated = truncateThreadName(full);
  if (truncated.truncated && warnings) {
    warnings.push({ code: "thread_name_truncated" });
  }
  const result = truncated.text.length > 0 ? truncated.text : THREAD_NAME_PREFIX.trim();
  if (result.length === 0) {
    return "Veille";
  }
  return result;
}

/**
 * Build main publication payload (texte court + embed) — gel 008.1A §8.1–§8.2.
 */
export function buildMainPublicationContent(
  input: BuildMainPublicationContentInput,
): BuildMainPublicationContentResult {
  const warnings: PublicationRenderWarning[] = [];

  if (!PUBLICATION_CHANNEL_ROLES_SET.has(input.channelRole)) {
    throw new PublicationContentError(
      `Invalid channel role: ${String(input.channelRole)}`,
    );
  }

  let title = sanitizeDiscordText(input.title ?? "");
  let summary = sanitizeDiscordText(input.content.summary ?? "", {
    preserveNewlines: true,
  });
  summary = normalizeWhitespace(summary);

  if (title.length === 0 && summary.length > 0) {
    title = summary;
    warnings.push({ code: "empty_fallback", detail: "title_from_summary" });
  }
  if (title.length === 0) {
    title = FALLBACK_TITLE;
    warnings.push({ code: "empty_fallback", detail: "title" });
  }
  if (summary.length === 0) {
    summary = FALLBACK_SUMMARY;
    warnings.push({ code: "empty_fallback", detail: "summary" });
  }

  const titleTrunc = truncateEmbedTitle(title);
  if (titleTrunc.truncated) {
    warnings.push({ code: "title_truncated" });
  }
  const summaryTrunc = truncateEmbedDescription(summary);
  if (summaryTrunc.truncated) {
    warnings.push({ code: "summary_truncated" });
  }

  const sources = preparePublicationSources(input.sources, warnings);
  const firstUrl = sources.find((s) => s.url !== null)?.url ?? null;

  let messageText = titleTrunc.text;
  if (firstUrl !== null) {
    messageText = `${titleTrunc.text} — ${firstUrl}`;
  }
  const messageTrunc = truncateMessageContent(messageText);
  if (messageTrunc.truncated) {
    warnings.push({ code: "message_truncated" });
  }

  const fields: DiscordEmbedFieldPayload[] = [];
  const category = sanitizeDiscordText(input.content.primaryCategory) || "other";
  const worthiness =
    sanitizeDiscordText(input.content.publishWorthiness) || "none";
  const composite = Number.isFinite(input.content.composite)
    ? Math.trunc(input.content.composite)
    : 0;

  pushField(fields, warnings, CATEGORY_FIELD_NAME, category, true);
  pushField(
    fields,
    warnings,
    PERTINENCE_FIELD_NAME,
    `${composite} · ${worthiness}`,
    true,
  );

  const sourcesValue = formatSourcesFieldValue(sources, warnings);
  if (sourcesValue !== null) {
    pushField(fields, warnings, SOURCES_FIELD_NAME, sourcesValue, false);
  } else {
    warnings.push({ code: "field_omitted", detail: SOURCES_FIELD_NAME });
  }

  pushField(
    fields,
    warnings,
    DATE_FIELD_NAME,
    formatUsefulDateUtc(input.usefulDate),
    true,
  );

  const footerText = truncateEmbedFooter(
    folderFooterSuffix(input.folderId),
  ).text;

  let embed: DiscordEmbedPayload = {
    title: titleTrunc.text,
    description: summaryTrunc.text,
    url: firstUrl ?? undefined,
    fields,
    footer: { text: footerText },
  };
  embed = enforceEmbedTotal(embed, warnings);

  if (
    (!embed.title || embed.title.length === 0) &&
    (!embed.description || embed.description.length === 0) &&
    messageTrunc.text.length === 0
  ) {
    throw new PublicationContentError(
      "Cannot build a valid Discord publication payload from empty content",
    );
  }

  const threadName = buildThreadName(input.title, warnings);

  return {
    payload: {
      content: messageTrunc.text,
      embeds: [embed],
    },
    threadName,
    channelRole: input.channelRole,
    warnings,
  };
}

/**
 * Build enrichment payload for the thread only — gel 008.1A §8.3.
 * Does not copy the main announcement layout.
 */
export function buildEnrichmentPublicationContent(
  input: BuildEnrichmentPublicationContentInput,
): BuildEnrichmentPublicationContentResult {
  const warnings: PublicationRenderWarning[] = [];

  const facts = [...input.newFacts]
    .map((f) => ({
      key: sanitizeDiscordText(f.key),
      value: sanitizeDiscordText(f.value),
    }))
    .filter((f) => f.key.length > 0 && f.value.length > 0)
    .sort((a, b) => {
      const byKey = a.key.localeCompare(b.key, "en");
      if (byKey !== 0) return byKey;
      return a.value.localeCompare(b.value, "en");
    });

  const sources = preparePublicationSources(input.newSources, warnings);

  if (facts.length === 0 && sources.length === 0) {
    throw new PublicationContentError(
      "Enrichment requires at least one new fact or displayable source",
    );
  }

  const factLines = facts.map((f) => `• ${f.key}: ${f.value}`);
  let description = factLines.join("\n");
  if (description.length === 0) {
    description = "Nouvelles sources.";
    warnings.push({ code: "empty_fallback", detail: "enrichment_description" });
  }
  const descTrunc = truncateEmbedDescription(description);
  if (descTrunc.truncated) {
    warnings.push({ code: "summary_truncated" });
  }

  const fields: DiscordEmbedFieldPayload[] = [];
  // Prefer listing facts as description; optional source field
  const sourcesValue = formatSourcesFieldValue(sources, warnings);
  if (sourcesValue !== null) {
    pushField(fields, warnings, "Nouvelles sources", sourcesValue, false);
  }

  // If too many fact lines would be better as fields under field cap — keep description primary.
  // Extra fact fields only when description alone is empty (already handled).

  let footerBits = folderFooterSuffix(input.folderId);
  const fp = input.aggregateFingerprint?.trim();
  if (fp && fp.length > 0) {
    const short = fp.slice(0, 8);
    footerBits = `${footerBits} · ${short}`;
  }
  const footerText = truncateEmbedFooter(footerBits).text;

  let embed: DiscordEmbedPayload = {
    title: "Enrichissement",
    description: descTrunc.text,
    fields: fields.length > 0 ? fields : undefined,
    footer: { text: footerText },
  };
  embed = enforceEmbedTotal(embed, warnings);

  const firstUrl = sources.find((s) => s.url !== null)?.url ?? null;
  let content = "Mise à jour du dossier";
  if (firstUrl !== null) {
    content = `Mise à jour du dossier — ${firstUrl}`;
  }
  const contentTrunc = truncateMessageContent(content);
  if (contentTrunc.truncated) {
    warnings.push({ code: "message_truncated" });
  }

  return {
    payload: {
      content: contentTrunc.text,
      embeds: [embed],
    },
    warnings,
  };
}
