import type {
  CollectSourceResult,
  SourceFetchState,
} from "./collect-types.js";
import { parseFeed as defaultParseFeed } from "./feed-parser.js";
import type { ParsedFeed } from "./feed-types.js";
import type { SecureHttpClient } from "./http-client.js";
import { resolveProvider } from "./providers/resolve-provider.js";
import type { SourceDefinition } from "./source-types.js";

export type ParseFeedFn = (input: Uint8Array | string) => ParsedFeed;

export interface IncrementalCollectorOptions {
  /** Secure HTTP client used for outbound fetches (required). */
  httpClient: SecureHttpClient;
  /** Injectable feed parser (defaults to `parseFeed`). */
  parseFeed?: ParseFeedFn;
}

export interface IncrementalCollector {
  collect(
    source: SourceDefinition,
    state?: SourceFetchState,
  ): Promise<CollectSourceResult>;
}

/**
 * Creates an incremental collector that dispatches to the source Provider
 * (RSS / Atom / GitHub Releases; HTML/API stubs refuse collection).
 * State is explicit and caller-owned; nothing is persisted.
 */
export function createIncrementalCollector(
  options: IncrementalCollectorOptions,
): IncrementalCollector {
  const context = {
    httpClient: options.httpClient,
    parseFeed: options.parseFeed ?? defaultParseFeed,
  };

  return {
    async collect(
      source: SourceDefinition,
      state?: SourceFetchState,
    ): Promise<CollectSourceResult> {
      const provider = resolveProvider(source.provider, context);
      return provider.collect(source, state);
    },
  };
}
