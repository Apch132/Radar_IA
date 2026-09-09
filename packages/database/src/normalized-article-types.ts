import type { NormalizedArticle } from "@prisma/client";

/**
 * Input structurally compatible with collector `NormalizedArticle`.
 * Defined locally to avoid coupling `@radar-ia/database` to `@radar-ia/collector`.
 */
export interface SaveNormalizedArticleInput {
  sourceId: string;
  sourceTier: string;
  externalId?: string;
  title: string;
  url: string;
  /** ISO 8601 UTC when available. */
  publishedAt?: string;
  /** Business update timestamp as ISO 8601 UTC when available. */
  updatedAt?: string;
  author?: string;
  summary?: string;
  content?: string;
  categories: readonly string[];
  feedFormat: string;
}

export type PersistNormalizedArticleOutcome =
  | "created"
  | "updated"
  | "unchanged";

export interface PersistNormalizedArticleResult {
  outcome: PersistNormalizedArticleOutcome;
  article: NormalizedArticle;
  /** Editorial fields that differ (empty for created/unchanged). */
  changedFields?: readonly string[];
  /** Stable editorial hash of the incoming payload when computed. */
  editorialHash?: string;
}

export interface PersistNormalizedArticlesResult {
  created: number;
  updated: number;
  /** Identity hit with identical business fields — no write (005 / 009.1C). */
  unchanged: number;
  articles: NormalizedArticle[];
}

export type { NormalizedArticle };
