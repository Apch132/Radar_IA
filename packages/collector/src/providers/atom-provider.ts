import { fetchAndParseFeed } from "./feed-fetch.js";
import type { SourceProvider, SourceProviderContext } from "./types.js";

/** Atom 1.0 provider (format validated after parse). */
export function createAtomProvider(context: SourceProviderContext): SourceProvider {
  return {
    type: "atom",
    collect(source, state) {
      return fetchAndParseFeed(source, state, {
        httpClient: context.httpClient,
        parseFeed: context.parseFeed,
        expectedFormat: "atom",
      });
    },
  };
}
