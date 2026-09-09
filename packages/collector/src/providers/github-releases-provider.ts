import { fetchAndParseFeed } from "./feed-fetch.js";
import type { SourceProvider, SourceProviderContext } from "./types.js";

/**
 * GitHub Releases provider.
 * v1 transport: Atom release feeds (`…/releases.atom`).
 * Future: GitHub Releases REST API without changing the Source → Provider contract.
 */
export function createGithubReleasesProvider(
  context: SourceProviderContext,
): SourceProvider {
  return {
    type: "github_releases",
    collect(source, state) {
      return fetchAndParseFeed(source, state, {
        httpClient: context.httpClient,
        parseFeed: context.parseFeed,
        expectedFormat: "atom",
      });
    },
  };
}
