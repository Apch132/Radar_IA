import type { ParsedFeed } from "./feed-types.js";
import type { SourceDefinition } from "./source-types.js";

/**
 * Serializable per-source HTTP cache validators.
 * Provided by the caller; no internal persistence.
 */
export interface SourceFetchState {
  readonly etag?: string;
  readonly lastModified?: string;
}

/** Result of a conditional fetch that found no new content. */
export interface CollectSourceNotModified {
  readonly status: "not-modified";
  readonly source: SourceDefinition;
  readonly state: SourceFetchState;
  readonly httpStatus: 304;
}

/** Result of a fetch that returned a new feed body. */
export interface CollectSourceUpdated {
  readonly status: "updated";
  readonly source: SourceDefinition;
  readonly state: SourceFetchState;
  readonly httpStatus: number;
  readonly feed: ParsedFeed;
}

/** Discriminated outcome of one incremental source collect. */
export type CollectSourceResult =
  | CollectSourceNotModified
  | CollectSourceUpdated;
