import type { SourceProviderType } from "../source-types.js";
import { createAtomProvider } from "./atom-provider.js";
import { createDisabledProvider } from "./disabled-provider.js";
import { createGithubReleasesProvider } from "./github-releases-provider.js";
import { createRssProvider } from "./rss-provider.js";
import type { SourceProvider, SourceProviderContext } from "./types.js";

/**
 * Resolve the concrete provider for a source type.
 * HTML / API are architectural stubs and always throw if invoked.
 */
export function resolveProvider(
  providerType: SourceProviderType,
  context: SourceProviderContext,
): SourceProvider {
  switch (providerType) {
    case "rss":
      return createRssProvider(context);
    case "atom":
      return createAtomProvider(context);
    case "github_releases":
      return createGithubReleasesProvider(context);
    case "html":
      return createDisabledProvider("html", context);
    case "api":
      return createDisabledProvider("api", context);
    default: {
      const exhaustive: never = providerType;
      throw new Error(`Unknown source provider: ${String(exhaustive)}`);
    }
  }
}
