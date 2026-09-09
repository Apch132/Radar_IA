/** Supported syndication formats for the raw feed reader. */
export type FeedFormat = "rss" | "atom";

/** Normalized article extracted from an RSS item or Atom entry. */
export interface ParsedFeedItem {
  title: string | null;
  /** Canonical permalink when available. */
  link: string | null;
  /** Stable identifier (RSS guid / Atom id) when present. */
  id: string | null;
  /** Short summary / description when present. */
  summary: string | null;
  author: string | null;
  /** Publication date when parseable; otherwise null. */
  publishedAt: Date | null;
  categories: string[];
  /** Full body / content:encoded / Atom content when present. */
  content: string | null;
}

/** Normalized feed representation shared by RSS 2.0 and Atom 1.0. */
export interface ParsedFeed {
  format: FeedFormat;
  title: string | null;
  /** RSS description or Atom subtitle. */
  description: string | null;
  /** Primary feed / site link. */
  link: string | null;
  language: string | null;
  /** Feed-level update timestamp when parseable. */
  updatedAt: Date | null;
  items: ParsedFeedItem[];
}
