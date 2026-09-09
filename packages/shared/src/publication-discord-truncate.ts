import {
  DISCORD_LIMITS,
  TRUNCATION_ELLIPSIS,
} from "./publication-discord-limits.js";
import type { TruncationResult } from "./publication-discord-types.js";
import { unicodeLength } from "./publication-discord-sanitize.js";

/**
 * Deterministic truncation with Unicode ellipsis.
 * Never invents content; empty input stays empty.
 */
export function truncateDiscordText(
  value: string,
  maxLength: number,
): TruncationResult {
  if (maxLength <= 0) {
    return { text: "", truncated: value.length > 0 };
  }
  const chars = Array.from(value);
  if (chars.length <= maxLength) {
    return { text: value, truncated: false };
  }
  if (maxLength === 1) {
    return { text: TRUNCATION_ELLIPSIS, truncated: true };
  }
  const kept = chars.slice(0, maxLength - 1).join("");
  return { text: `${kept}${TRUNCATION_ELLIPSIS}`, truncated: true };
}

export function truncateMessageContent(value: string): TruncationResult {
  return truncateDiscordText(value, DISCORD_LIMITS.MESSAGE_CONTENT);
}

export function truncateEmbedTitle(value: string): TruncationResult {
  return truncateDiscordText(value, DISCORD_LIMITS.EMBED_TITLE);
}

export function truncateEmbedDescription(value: string): TruncationResult {
  return truncateDiscordText(value, DISCORD_LIMITS.EMBED_DESCRIPTION);
}

export function truncateEmbedFieldName(value: string): TruncationResult {
  return truncateDiscordText(value, DISCORD_LIMITS.EMBED_FIELD_NAME);
}

export function truncateEmbedFieldValue(value: string): TruncationResult {
  return truncateDiscordText(value, DISCORD_LIMITS.EMBED_FIELD_VALUE);
}

export function truncateEmbedFooter(value: string): TruncationResult {
  return truncateDiscordText(value, DISCORD_LIMITS.EMBED_FOOTER);
}

export function truncateThreadName(value: string): TruncationResult {
  return truncateDiscordText(value, DISCORD_LIMITS.THREAD_NAME);
}

/** Character budget used by an embed toward DISCORD_LIMITS.EMBED_TOTAL. */
export function embedCharacterCount(embed: {
  readonly title?: string;
  readonly description?: string;
  readonly fields?: readonly {
    readonly name: string;
    readonly value: string;
  }[];
  readonly footer?: { readonly text: string };
}): number {
  let total = 0;
  if (embed.title) total += unicodeLength(embed.title);
  if (embed.description) total += unicodeLength(embed.description);
  if (embed.footer?.text) total += unicodeLength(embed.footer.text);
  for (const field of embed.fields ?? []) {
    total += unicodeLength(field.name) + unicodeLength(field.value);
  }
  return total;
}
