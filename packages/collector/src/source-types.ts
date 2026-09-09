/** Official source trust tiers (social networks excluded by doctrine). */
export type SourceTier = "S" | "A" | "B" | "C" | "D" | "E";

/**
 * Collection provider types.
 * Active: rss, atom, github_releases.
 * Prepared but disabled: html, api.
 */
export type SourceProviderType =
  | "rss"
  | "atom"
  | "github_releases"
  | "html"
  | "api";

/** Minimal configurable source definition. */
export interface SourceDefinition {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly tier: SourceTier;
  readonly enabled: boolean;
  readonly provider: SourceProviderType;
}

/** Immutable registry loaded from an external JSON file. */
export interface SourceRegistry {
  readonly sources: readonly SourceDefinition[];
}

/** Allowed tier values, in doctrine order. */
export const SOURCE_TIERS = ["S", "A", "B", "C", "D", "E"] as const satisfies readonly SourceTier[];

/** All known provider types (including prepared/disabled stubs). */
export const SOURCE_PROVIDER_TYPES = [
  "rss",
  "atom",
  "github_releases",
  "html",
  "api",
] as const satisfies readonly SourceProviderType[];

/** Providers that can collect today. */
export const ACTIVE_SOURCE_PROVIDER_TYPES = [
  "rss",
  "atom",
  "github_releases",
] as const satisfies readonly SourceProviderType[];

/** Providers reserved for future work — must stay disabled in registry. */
export const DISABLED_SOURCE_PROVIDER_TYPES = [
  "html",
  "api",
] as const satisfies readonly SourceProviderType[];
