import {
  ArticleNormalizationError,
  InvalidArticleUrlError,
  MissingArticleTitleError,
  MissingArticleUrlError,
} from "./article-errors.js";
import type {
  ArticleRejectionCategory,
  NormalizedArticle,
  NormalizeFeedResult,
  RejectedArticle,
} from "./article-types.js";
import type { ParsedFeed, ParsedFeedItem } from "./feed-types.js";
import type { SourceDefinition } from "./source-types.js";

/**
 * Canonicalize an article permalink for stable storage and comparison.
 * Accepts absolute http/https only; strips fragment and default ports;
 * lowercases hostname; keeps path and query (including tracking params).
 * Does not resolve DNS, follow redirects, or strip utm_* parameters.
 */
export function canonicalizeArticleUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new InvalidArticleUrlError("Article URL is empty.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch (cause) {
    throw new InvalidArticleUrlError("Article URL is not a valid absolute URL.", {
      cause,
    });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidArticleUrlError(
      "Article URL protocol must be http: or https:.",
    );
  }

  if (!parsed.hostname) {
    throw new InvalidArticleUrlError(
      "Article URL must be absolute with a hostname.",
    );
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new InvalidArticleUrlError(
      "Article URL must not contain credentials.",
    );
  }

  const protocol = parsed.protocol;
  const host = parsed.hostname.toLowerCase();
  const defaultPort = protocol === "https:" ? "443" : "80";
  const port = parsed.port && parsed.port !== defaultPort ? `:${parsed.port}` : "";
  const pathname = parsed.pathname === "" ? "/" : parsed.pathname;

  return `${protocol}//${host}${port}${pathname}${parsed.search}`;
}

/**
 * Normalize a single feed item into the common article contract.
 * Throws on missing title, missing URL, or invalid URL.
 * Does not mutate inputs. Deterministic; no I/O.
 */
export function normalizeArticle(
  source: SourceDefinition,
  feed: ParsedFeed,
  item: ParsedFeedItem,
): NormalizedArticle {
  const title = normalizeTitle(item.title);
  if (title === undefined) {
    throw new MissingArticleTitleError();
  }

  if (item.link === null || item.link.trim().length === 0) {
    throw new MissingArticleUrlError();
  }

  const url = canonicalizeArticleUrl(item.link);
  const externalId = normalizeExternalId(item.id);
  const publishedAt = normalizeDate(item.publishedAt);
  const author = normalizeOptionalText(item.author);
  const summary = normalizeOptionalText(item.summary);
  const content = normalizeOptionalText(item.content);
  const categories = normalizeCategories(item.categories);

  return {
    sourceId: source.id,
    sourceTier: source.tier,
    ...(externalId !== undefined ? { externalId } : {}),
    title,
    url,
    ...(publishedAt !== undefined ? { publishedAt } : {}),
    ...(author !== undefined ? { author } : {}),
    ...(summary !== undefined ? { summary } : {}),
    ...(content !== undefined ? { content } : {}),
    categories,
    feedFormat: feed.format,
  };
}

/**
 * Normalize every item in a feed. Invalid items are rejected without
 * aborting the batch. Inputs are never mutated.
 */
export function normalizeFeedArticles(
  source: SourceDefinition,
  feed: ParsedFeed,
): NormalizeFeedResult {
  const articles: NormalizedArticle[] = [];
  const rejected: RejectedArticle[] = [];

  for (let index = 0; index < feed.items.length; index += 1) {
    const item = feed.items[index]!;
    try {
      articles.push(normalizeArticle(source, feed, item));
    } catch (error) {
      rejected.push(toRejectedArticle(index, item, error));
    }
  }

  return { articles, rejected };
}

function toRejectedArticle(
  index: number,
  item: ParsedFeedItem,
  error: unknown,
): RejectedArticle {
  const externalId = normalizeExternalId(item.id);

  if (error instanceof ArticleNormalizationError) {
    return {
      index,
      ...(externalId !== undefined ? { externalId } : {}),
      category: error.name as ArticleRejectionCategory,
      message: error.message,
      ...(error.cause !== undefined ? { cause: error.cause } : {}),
    };
  }

  return {
    index,
    ...(externalId !== undefined ? { externalId } : {}),
    category: "InvalidArticleUrlError",
    message: "Article normalization failed.",
    cause: error,
  };
}

function normalizeTitle(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }
  const normalized = collapseWhitespace(value);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeOptionalText(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeExternalId(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Convert a parser date to ISO 8601 UTC.
 * Invalid or missing dates are omitted (never invented).
 */
function normalizeDate(value: Date | null): string | undefined {
  if (value === null) {
    return undefined;
  }
  const time = value.getTime();
  if (Number.isNaN(time)) {
    return undefined;
  }
  return value.toISOString();
}

/**
 * Trim, drop empties, case-insensitive dedupe (keep first spelling),
 * preserve first-seen order.
 */
function normalizeCategories(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of values) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
