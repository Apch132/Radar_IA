import type { CollectSourceResult, SourceFetchState } from "../collect-types.js";
import type { ParseFeedFn } from "../collect-source.js";
import type { SecureHttpClient } from "../http-client.js";
import type { SourceDefinition, SourceProviderType } from "../source-types.js";

/** Runtime context shared by all providers. */
export interface SourceProviderContext {
  readonly httpClient: SecureHttpClient;
  readonly parseFeed: ParseFeedFn;
}

/**
 * Provider contract: Source → Provider → ParsedFeed (via CollectSourceResult).
 * Downstream normalisation / matching / analysis / publication stay unchanged.
 */
export interface SourceProvider {
  readonly type: SourceProviderType;
  collect(
    source: SourceDefinition,
    state?: SourceFetchState,
  ): Promise<CollectSourceResult>;
}

export type SourceProviderFactory = (
  context: SourceProviderContext,
) => SourceProvider;
