import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import {
  DuplicateSourceIdError,
  DuplicateSourceUrlError,
  InvalidSourceRegistryError,
  SourceRegistryError,
} from "./source-errors.js";
import {
  DISABLED_SOURCE_PROVIDER_TYPES,
  SOURCE_PROVIDER_TYPES,
  type SourceDefinition,
  type SourceProviderType,
  type SourceRegistry,
} from "./source-types.js";

/** Stable slug: lowercase ASCII, digits, hyphens; bounded length. */
const SOURCE_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const MAX_NAME_LENGTH = 200;

const DISABLED_PROVIDER_SET = new Set<string>(DISABLED_SOURCE_PROVIDER_TYPES);

/**
 * Report for a single source rejected during resilient parsing.
 * Never includes secrets or raw file contents beyond the reason message.
 */
export type InvalidSourceReport = {
  readonly index: number;
  readonly sourceId: string | null;
  readonly provider: string | null;
  readonly reason: string;
  readonly action: "disabled";
};

export type ParseSourceRegistryOptions = {
  /**
   * `strict` (default for `parseSourceRegistry`): throw on the first invalid source.
   * `resilient` (default for `loadSourceRegistry`): skip invalid sources and continue.
   */
  readonly mode?: "strict" | "resilient";
  /** Invoked once per skipped/rejected source (resilient mode, or before throw in strict). */
  readonly onInvalidSource?: (report: InvalidSourceReport) => void;
};

export type LoadSourceRegistryOptions = ParseSourceRegistryOptions;

function sourcePathLabel(index: number, id?: string): string {
  if (id) {
    return `sources[${index}] (id="${id}")`;
  }
  return `sources[${index}]`;
}

/**
 * Normalize a feed URL for uniqueness comparison.
 * Hostname is lowercased; default ports and trailing slashes (except root) are dropped.
 * Does not perform DNS resolution.
 */
function normalizeSourceUrl(url: URL): string {
  const protocol = url.protocol;
  const host = url.hostname.toLowerCase();
  const defaultPort = protocol === "https:" ? "443" : "80";
  const port = url.port && url.port !== defaultPort ? `:${url.port}` : "";
  let pathname = url.pathname === "" ? "/" : url.pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  return `${protocol}//${host}${port}${pathname}${url.search}`;
}

function assertHttpUrl(raw: string, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (cause) {
    throw new InvalidSourceRegistryError(`${label}: invalid URL.`, { cause });
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new InvalidSourceRegistryError(
      `${label}: URL protocol must be http: or https:.`,
    );
  }

  if (parsed.username !== "" || parsed.password !== "") {
    throw new InvalidSourceRegistryError(
      `${label}: URL must not contain credentials.`,
    );
  }

  if (parsed.hash !== "") {
    throw new InvalidSourceRegistryError(
      `${label}: URL must not contain a fragment.`,
    );
  }

  if (!parsed.hostname) {
    throw new InvalidSourceRegistryError(
      `${label}: URL must be absolute with a hostname.`,
    );
  }

  return parsed;
}

const sourceDefinitionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    url: z.string(),
    tier: z.enum(["S", "A", "B", "C", "D", "E"]),
    enabled: z.boolean(),
    provider: z.enum(SOURCE_PROVIDER_TYPES),
  })
  .strict();

/** Root only — sources validated one-by-one so one bad entry cannot reject the file. */
const sourceRegistryRootSchema = z
  .object({
    sources: z.array(z.unknown()),
  })
  .strict();

function validateSourceDefinition(
  raw: z.infer<typeof sourceDefinitionSchema>,
  index: number,
): SourceDefinition {
  const label = sourcePathLabel(index, raw.id);

  if (!SOURCE_ID_PATTERN.test(raw.id)) {
    throw new InvalidSourceRegistryError(
      `${label}: id must be a slug of lowercase ASCII letters, digits and hyphens (2–64 chars, start/end alphanumeric).`,
    );
  }

  const name = raw.name.trim();
  if (name.length === 0) {
    throw new InvalidSourceRegistryError(`${label}: name must not be empty.`);
  }
  if (name.length > MAX_NAME_LENGTH) {
    throw new InvalidSourceRegistryError(
      `${label}: name must be at most ${MAX_NAME_LENGTH} characters.`,
    );
  }

  const parsedUrl = assertHttpUrl(raw.url, label);
  const normalizedUrl = normalizeSourceUrl(parsedUrl);
  const provider = raw.provider as SourceProviderType;

  if (DISABLED_PROVIDER_SET.has(provider) && raw.enabled) {
    throw new InvalidSourceRegistryError(
      `${label}: provider "${provider}" is prepared but disabled — set enabled=false.`,
    );
  }

  return Object.freeze({
    id: raw.id,
    name,
    url: normalizedUrl,
    tier: raw.tier,
    enabled: raw.enabled,
    provider,
  });
}

function peekSourceId(raw: unknown): string | null {
  if (
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    "id" in raw &&
    typeof (raw as { id: unknown }).id === "string"
  ) {
    return (raw as { id: string }).id;
  }
  return null;
}

function peekSourceProvider(raw: unknown): string | null {
  if (
    raw !== null &&
    typeof raw === "object" &&
    !Array.isArray(raw) &&
    "provider" in raw &&
    typeof (raw as { provider: unknown }).provider === "string"
  ) {
    return (raw as { provider: string }).provider;
  }
  return null;
}

function mapSourceZodIssue(
  index: number,
  issue: z.ZodIssue,
  sourceId: string | null,
): string {
  const label = sourcePathLabel(index, sourceId ?? undefined);

  if (issue.code === "unrecognized_keys") {
    const keys = issue.keys.join(", ");
    return `${label}: unknown propert${issue.keys.length === 1 ? "y" : "ies"}: ${keys}.`;
  }

  if (issue.path.length >= 1 && typeof issue.path[0] === "string") {
    const field = issue.path[0];
    return `${label}: invalid "${field}": ${issue.message}`;
  }

  return `${label}: ${issue.message}`;
}

function mapRootZodError(error: z.ZodError): SourceRegistryError {
  const issue = error.issues[0];
  if (!issue) {
    return new InvalidSourceRegistryError("Invalid source registry.");
  }

  if (issue.code === "unrecognized_keys") {
    const keys = issue.keys.join(", ");
    return new InvalidSourceRegistryError(
      `Unknown root propert${issue.keys.length === 1 ? "y" : "ies"}: ${keys}.`,
    );
  }

  if (issue.path.length === 0) {
    return new InvalidSourceRegistryError(
      `Invalid source registry root: ${issue.message}`,
    );
  }

  if (issue.path[0] === "sources") {
    return new InvalidSourceRegistryError(
      `Invalid "sources": ${issue.message}`,
    );
  }

  return new InvalidSourceRegistryError(
    `Invalid source registry: ${issue.message}`,
  );
}

function emitInvalid(
  options: ParseSourceRegistryOptions | undefined,
  report: InvalidSourceReport,
): void {
  options?.onInvalidSource?.(report);
}

function rejectOrSkipSource(
  options: ParseSourceRegistryOptions | undefined,
  report: InvalidSourceReport,
  error: SourceRegistryError,
): "skip" {
  emitInvalid(options, report);
  if ((options?.mode ?? "strict") === "resilient") {
    return "skip";
  }
  throw error;
}

/** Strip a leading UTF-8 BOM so string-based parses match Buffer+TextDecoder. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Parse and strictly validate a source registry from JSON text or UTF-8 bytes.
 * Does not perform network I/O or DNS resolution.
 *
 * Per-source failures:
 * - `mode: "strict"` (default) — throw (historical behaviour).
 * - `mode: "resilient"` — skip the source, invoke `onInvalidSource`, continue.
 *
 * Structural failures (invalid JSON, missing `sources`, unknown root keys) always throw.
 */
export function parseSourceRegistry(
  input: string | Uint8Array,
  options?: ParseSourceRegistryOptions,
): SourceRegistry {
  const text = stripBom(
    typeof input === "string" ? input : new TextDecoder("utf-8").decode(input),
  );

  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (cause) {
    throw new InvalidSourceRegistryError("Invalid JSON in source registry.", {
      cause,
    });
  }

  const parsed = sourceRegistryRootSchema.safeParse(json);
  if (!parsed.success) {
    throw mapRootZodError(parsed.error);
  }

  // Empty registry is accepted: allows bootstrapping and staged enablement.
  const definitions: SourceDefinition[] = [];
  const seenIds = new Map<string, number>();
  const seenUrls = new Map<string, number>();

  for (let index = 0; index < parsed.data.sources.length; index += 1) {
    const rawSource = parsed.data.sources[index];
    const sourceId = peekSourceId(rawSource);
    const provider = peekSourceProvider(rawSource);
    const label = sourcePathLabel(index, sourceId ?? undefined);

    const shaped = sourceDefinitionSchema.safeParse(rawSource);
    if (!shaped.success) {
      const issue = shaped.error.issues[0];
      const reason = issue
        ? mapSourceZodIssue(index, issue, sourceId)
        : `${label}: invalid source definition.`;
      rejectOrSkipSource(
        options,
        {
          index,
          sourceId,
          provider,
          reason,
          action: "disabled",
        },
        new InvalidSourceRegistryError(reason),
      );
      continue;
    }

    let definition: SourceDefinition;
    try {
      definition = validateSourceDefinition(shaped.data, index);
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : `${label}: invalid source.`;
      const registryError =
        error instanceof SourceRegistryError
          ? error
          : new InvalidSourceRegistryError(reason, { cause: error });
      rejectOrSkipSource(
        options,
        {
          index,
          sourceId: shaped.data.id,
          provider: shaped.data.provider,
          reason,
          action: "disabled",
        },
        registryError,
      );
      continue;
    }

    const previousIdIndex = seenIds.get(definition.id);
    if (previousIdIndex !== undefined) {
      const reason = `Duplicate source id "${definition.id}" at sources[${index}] (already defined at sources[${previousIdIndex}]).`;
      rejectOrSkipSource(
        options,
        {
          index,
          sourceId: definition.id,
          provider: definition.provider,
          reason,
          action: "disabled",
        },
        new DuplicateSourceIdError(definition.id, reason),
      );
      continue;
    }

    const previousUrlIndex = seenUrls.get(definition.url);
    if (previousUrlIndex !== undefined) {
      const reason = `Duplicate source URL at sources[${index}] (already defined at sources[${previousUrlIndex}]).`;
      rejectOrSkipSource(
        options,
        {
          index,
          sourceId: definition.id,
          provider: definition.provider,
          reason,
          action: "disabled",
        },
        new DuplicateSourceUrlError(definition.url, reason),
      );
      continue;
    }

    seenIds.set(definition.id, index);
    seenUrls.set(definition.url, index);
    definitions.push(definition);
  }

  return Object.freeze({
    sources: Object.freeze(definitions),
  });
}

function displayPath(filePath: string | URL): string {
  if (filePath instanceof URL) {
    try {
      return basename(fileURLToPath(filePath));
    } catch {
      return filePath.href;
    }
  }
  return basename(filePath);
}

/**
 * Load a source registry from a local JSON file path or file: URL.
 * Does not perform network I/O beyond reading the local file.
 *
 * Defaults to **resilient** mode: one invalid source is disabled/skipped
 * and reported via `onInvalidSource`; other sources keep working.
 * Pass `mode: "strict"` to restore fail-fast behaviour.
 */
export async function loadSourceRegistry(
  filePath: string | URL,
  options?: LoadSourceRegistryOptions,
): Promise<SourceRegistry> {
  const label = displayPath(filePath);

  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch (cause) {
    const code =
      cause && typeof cause === "object" && "code" in cause
        ? String((cause as { code: unknown }).code)
        : undefined;

    if (code === "ENOENT") {
      throw new InvalidSourceRegistryError(
        `Source registry file not found: ${label}.`,
        { cause },
      );
    }

    throw new InvalidSourceRegistryError(
      `Failed to read source registry file: ${label}.`,
      { cause },
    );
  }

  return parseSourceRegistry(bytes, {
    mode: options?.mode ?? "resilient",
    onInvalidSource: options?.onInvalidSource,
  });
}

/** Return enabled sources from a registry (stable order preserved). */
export function getEnabledSources(
  registry: SourceRegistry,
): readonly SourceDefinition[] {
  return registry.sources.filter((source) => source.enabled);
}
