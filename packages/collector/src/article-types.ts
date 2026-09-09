import type { FeedFormat } from "./feed-types.js";
import type { SourceTier } from "./source-types.js";

/**
 * Common business article model shared by RSS and Atom consumers.
 * No persistence, scoring, LLM, or Discord fields at this stage.
 */
export interface NormalizedArticle {
  readonly sourceId: string;
  readonly sourceTier: SourceTier;
  /** Editorial identifier from RSS guid / Atom id when present. */
  readonly externalId?: string;
  readonly title: string;
  /** Canonical absolute HTTP(S) article URL. */
  readonly url: string;
  /** Publication timestamp as ISO 8601 UTC when available. */
  readonly publishedAt?: string;
  /** Update timestamp as ISO 8601 UTC when available. */
  readonly updatedAt?: string;
  readonly author?: string;
  /** Raw summary as provided by the feed (trimmed only). */
  readonly summary?: string;
  /** Raw content as provided by the feed (trimmed only). */
  readonly content?: string;
  readonly categories: readonly string[];
  readonly feedFormat: FeedFormat;
}

/** Stable rejection categories for batch normalization. */
export type ArticleRejectionCategory =
  | "MissingArticleTitleError"
  | "MissingArticleUrlError"
  | "InvalidArticleUrlError";

/** One feed item that could not be normalized. */
export interface RejectedArticle {
  readonly index: number;
  readonly externalId?: string;
  readonly category: ArticleRejectionCategory;
  readonly message: string;
  readonly cause?: unknown;
}

/** Batch result: successes plus non-fatal per-item rejections. */
export interface NormalizeFeedResult {
  readonly articles: readonly NormalizedArticle[];
  readonly rejected: readonly RejectedArticle[];
}
