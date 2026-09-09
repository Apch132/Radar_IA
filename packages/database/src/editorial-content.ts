import { createHash } from "node:crypto";

import type { SaveNormalizedArticleInput } from "./normalized-article-types.js";

/** Tracking / volatile query params ignored for editorial identity. */
const TRACKING_PARAM_PREFIXES = ["utm_", "mc_"] as const;
const TRACKING_PARAM_EXACT = new Set([
  "fbclid",
  "gclid",
  "gclsrc",
  "dclid",
  "msclkid",
  "twclid",
  "igshid",
  "ref",
  "ref_src",
  "ref_url",
  "ncid",
  "cmpid",
  "campaign_id",
  "source",
  "medium",
]);

export type EditorialFieldName =
  | "sourceTier"
  | "title"
  | "url"
  | "publishedAt"
  | "author"
  | "summary"
  | "content"
  | "categories"
  | "feedFormat"
  | "externalId";

export type EditorialSnapshot = {
  readonly sourceTier: string;
  readonly title: string;
  readonly url: string;
  readonly publishedAt: string | null;
  readonly author: string | null;
  readonly summary: string | null;
  readonly content: string | null;
  readonly categories: readonly string[];
  readonly feedFormat: string;
  readonly externalId: string | null;
};

/**
 * Collapse whitespace / newlines that have no editorial effect.
 */
export function normalizeEditorialText(value: string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  const collapsed = value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return collapsed.length === 0 ? null : collapsed;
}

/**
 * Canonicalize URL for editorial comparison: strip hash, drop tracking params,
 * normalize host case, drop default ports and trailing slash on non-root paths.
 */
export function canonicalizeEditorialUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl.trim());
    url.hash = "";
    url.username = "";
    url.password = "";
    url.hostname = url.hostname.toLowerCase();
    if (
      (url.protocol === "http:" && url.port === "80") ||
      (url.protocol === "https:" && url.port === "443")
    ) {
      url.port = "";
    }
    const kept = new URLSearchParams();
    const keys = [...url.searchParams.keys()].sort();
    for (const key of keys) {
      const lower = key.toLowerCase();
      if (TRACKING_PARAM_EXACT.has(lower)) {
        continue;
      }
      if (TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
        continue;
      }
      for (const value of url.searchParams.getAll(key)) {
        kept.append(key, value);
      }
    }
    url.search = kept.toString();
    let href = url.toString();
    if (url.pathname.length > 1 && href.endsWith("/")) {
      href = href.slice(0, -1);
    }
    return href;
  } catch {
    return rawUrl.trim();
  }
}

function normalizeCategories(categories: readonly string[]): string[] {
  return [...categories]
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length > 0)
    .map((value) => value.toLowerCase())
    .sort((a, b) => a.localeCompare(b));
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function buildEditorialSnapshot(input: {
  sourceTier: string;
  title: string;
  url: string;
  publishedAt?: Date | string | null;
  author?: string | null;
  summary?: string | null;
  content?: string | null;
  categories: readonly string[];
  feedFormat: string;
  externalId?: string | null;
}): EditorialSnapshot {
  return {
    sourceTier: input.sourceTier.trim().toUpperCase(),
    title: normalizeEditorialText(input.title) ?? "",
    url: canonicalizeEditorialUrl(input.url),
    publishedAt: toIsoOrNull(input.publishedAt),
    author: normalizeEditorialText(input.author),
    summary: normalizeEditorialText(input.summary),
    content: normalizeEditorialText(input.content),
    categories: normalizeCategories(input.categories),
    feedFormat: input.feedFormat.trim().toLowerCase(),
    externalId:
      input.externalId === undefined || input.externalId === null
        ? null
        : input.externalId.trim() === ""
          ? null
          : input.externalId.trim(),
  };
}

export function editorialSnapshotFromSaveInput(
  input: SaveNormalizedArticleInput,
): EditorialSnapshot {
  return buildEditorialSnapshot({
    sourceTier: input.sourceTier,
    title: input.title,
    url: input.url,
    publishedAt: input.publishedAt,
    author: input.author,
    summary: input.summary,
    content: input.content,
    categories: input.categories,
    feedFormat: input.feedFormat,
    externalId: input.externalId,
  });
}

export function computeEditorialHash(snapshot: EditorialSnapshot): string {
  const payload = JSON.stringify({
    sourceTier: snapshot.sourceTier,
    title: snapshot.title,
    url: snapshot.url,
    publishedAt: snapshot.publishedAt,
    author: snapshot.author,
    summary: snapshot.summary,
    content: snapshot.content,
    categories: snapshot.categories,
    feedFormat: snapshot.feedFormat,
    externalId: snapshot.externalId,
  });
  return createHash("sha256").update(payload, "utf8").digest("hex");
}

export function listEditorialChangedFields(
  existing: EditorialSnapshot,
  incoming: EditorialSnapshot,
): EditorialFieldName[] {
  const changed: EditorialFieldName[] = [];
  const fields: EditorialFieldName[] = [
    "sourceTier",
    "title",
    "url",
    "publishedAt",
    "author",
    "summary",
    "content",
    "categories",
    "feedFormat",
    "externalId",
  ];
  for (const field of fields) {
    const left = existing[field];
    const right = incoming[field];
    if (Array.isArray(left) && Array.isArray(right)) {
      if (
        left.length !== right.length ||
        left.some((value, index) => value !== right[index])
      ) {
        changed.push(field);
      }
      continue;
    }
    if (left !== right) {
      changed.push(field);
    }
  }
  return changed;
}

/**
 * Editorial equality for persistence — excludes volatile feed `updatedAt`,
 * collection timestamps, attribute order, tracking params, and whitespace-only diffs.
 */
export function isEditorialUnchanged(
  existing: {
    sourceTier: string;
    title: string;
    url: string;
    publishedAt: Date | null;
    author: string | null;
    summary: string | null;
    content: string | null;
    categories: readonly string[];
    feedFormat: string;
    externalId: string | null;
  },
  input: SaveNormalizedArticleInput,
): { unchanged: boolean; changedFields: EditorialFieldName[]; editorialHash: string } {
  const existingSnapshot = buildEditorialSnapshot({
    sourceTier: existing.sourceTier,
    title: existing.title,
    url: existing.url,
    publishedAt: existing.publishedAt,
    author: existing.author,
    summary: existing.summary,
    content: existing.content,
    categories: existing.categories,
    feedFormat: existing.feedFormat,
    externalId: existing.externalId,
  });
  const incomingSnapshot = editorialSnapshotFromSaveInput(input);
  const changedFields = listEditorialChangedFields(
    existingSnapshot,
    incomingSnapshot,
  );
  return {
    unchanged: changedFields.length === 0,
    changedFields,
    editorialHash: computeEditorialHash(incomingSnapshot),
  };
}
