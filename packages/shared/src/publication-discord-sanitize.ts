/**
 * Deterministic Discord content sanitization (gel 008.1A §14).
 * Pure — no discord.js, no env, no network.
 */

/** Unicode length in code points (consistent with @radar-ia/analysis). */
export function unicodeLength(value: string): number {
  return Array.from(value).length;
}

/** Collapse runs of whitespace and trim. */
export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/** Strip C0/C1 control characters (keep TAB/LF/CR for intermediate processing). */
export function stripControlCharacters(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu, "");
}

const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Strip HTML tags/comments and decode a minimal set of entities.
 * Deterministic; does not invent content.
 */
export function stripHtml(value: string): string {
  let out = value.replace(HTML_COMMENT_RE, " ");
  out = out.replace(HTML_TAG_RE, " ");
  out = out.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (_, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      if (!Number.isFinite(code) || code < 0) {
        return "";
      }
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    }
    return HTML_ENTITIES[entity.toLowerCase()] ?? "";
  });
  return out;
}

/**
 * Neutralize Discord mention triggers without producing an active mention.
 * Inserts a zero-width space after `@` for everyone/here and known mention forms.
 */
export function neutralizeMentions(value: string): string {
  let out = value;
  out = out.replace(/@everyone/giu, "@\u200beveryone");
  out = out.replace(/@here/giu, "@\u200bhere");
  // User / role / channel / slash-command style mentions
  out = out.replace(/<@!?(\d+)>/gu, "<@\u200b$1>");
  out = out.replace(/<@&(\d+)>/gu, "<@&\u200b$1>");
  out = out.replace(/<#(\d+)>/gu, "<#\u200b$1>");
  // Bare @numeric patterns that Discord may resolve
  out = out.replace(/@(\d{5,})/gu, "@\u200b$1");
  return out;
}

/**
 * Full sanitize pipeline for text destined to Discord:
 * HTML → control chars → mentions → whitespace normalize (optional).
 */
export function sanitizeDiscordText(
  value: string,
  options: { readonly preserveNewlines?: boolean } = {},
): string {
  let out = stripHtml(value);
  out = stripControlCharacters(out);
  out = neutralizeMentions(out);
  if (options.preserveNewlines) {
    out = out
      .replace(/[^\S\n\r]+/gu, " ")
      .replace(/\r\n?/gu, "\n")
      .replace(/\n{3,}/gu, "\n\n")
      .trim();
  } else {
    out = normalizeWhitespace(out);
  }
  return out;
}

/**
 * Accept only http(s) URLs. Does not invent URLs.
 * Returns null when invalid / non-http(s).
 */
export function acceptHttpUrl(url: string | null | undefined): string | null {
  if (url == null) {
    return null;
  }
  const trimmed = url.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  return parsed.toString();
}
