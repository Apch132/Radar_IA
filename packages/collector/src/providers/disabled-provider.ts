import { SourceCollectError } from "../collect-errors.js";
import type { SourceProviderType } from "../source-types.js";
import type { SourceProvider, SourceProviderContext } from "./types.js";

/**
 * Stub for providers prepared in architecture but not yet active (HTML / API).
 * Sources using these types must stay `enabled: false` in the registry.
 */
export function createDisabledProvider(
  type: Extract<SourceProviderType, "html" | "api">,
  _context: SourceProviderContext,
): SourceProvider {
  return {
    type,
    async collect(source) {
      throw new SourceCollectError(
        source.id,
        `Provider "${type}" is prepared but disabled (source "${source.id}").`,
      );
    },
  };
}
