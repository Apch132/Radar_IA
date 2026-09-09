import { fetchAndParseFeed } from "./feed-fetch.js";
import type { SourceProvider, SourceProviderContext } from "./types.js";

/** RSS 2.0 provider (format validated after parse). */
export function createRssProvider(context: SourceProviderContext): SourceProvider {
  return {
    type: "rss",
    collect(source, state) {
      return fetchAndParseFeed(source, state, {
        httpClient: context.httpClient,
        parseFeed: context.parseFeed,
        expectedFormat: "rss",
      });
    },
  };
}
