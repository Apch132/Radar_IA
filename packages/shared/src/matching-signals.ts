import { MATCHING_THRESHOLDS } from "./matching-thresholds.js";
import type {
  AnnouncementNature,
  EventFingerprint,
  MatchingArticleInput,
  MatchingEnrichmentFact,
  MatchingSourceTier,
} from "./matching-types.js";

const SOURCE_TIER_RANK: Record<MatchingSourceTier, number> = {
  S: 6,
  A: 5,
  B: 4,
  C: 3,
  D: 2,
  E: 1,
};

const NATURE_PATTERNS: ReadonlyArray<{
  nature: AnnouncementNature;
  pattern: RegExp;
}> = [
  {
    nature: "denial",
    pattern: /\b(deny|denies|denied|démenti|dementi|false\s+rumor)\b/i,
  },
  {
    nature: "correction",
    pattern: /\b(corrects?|correction|erratum|clarif(?:y|ies|ication))\b/i,
  },
  {
    nature: "acquisition",
    pattern: /\b(acqui(?:re|res|red|sition)|buys?|bought|merger)\b/i,
  },
  {
    nature: "paper",
    pattern: /\b(paper|arxiv|preprint|research\s+study|publie(?:r|d)?\s+une?\s+étude)\b/i,
  },
  {
    nature: "launch",
    pattern:
      /\b(launch(?:es|ed)?|unveils?|introduces?|annonce|announces?|announced|releases?\s+new|sortie)\b/i,
  },
  {
    nature: "update",
    pattern:
      /\b(update[sd]?|upgrades?|improves?|mise\s+[àa]\s+jour|changelog)\b/i,
  },
  {
    nature: "availability",
    pattern:
      /\b(generally\s+available|ga\b|public\s+preview|waitlist|available\s+in|disponible)\b/i,
  },
];

const KNOWN_ORGS = [
  "openai",
  "anthropic",
  "google",
  "deepmind",
  "meta",
  "microsoft",
  "amazon",
  "aws",
  "nvidia",
  "mistral",
  "cohere",
  "huggingface",
  "hugging face",
  "xai",
  "apple",
  "ibm",
  "stability ai",
  "perplexity",
  "databricks",
] as const;

const INCOMPATIBLE_NATURE_PAIRS: ReadonlySet<string> = new Set([
  pairKey("launch", "acquisition"),
  pairKey("paper", "acquisition"),
  pairKey("availability", "acquisition"),
  pairKey("launch", "paper"),
]);

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Normalize labels for deterministic set comparisons. */
export function normalizeToken(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.+-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Canonicalize article / document URLs for exact-event URL matching. */
export function canonicalizeMatchingUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    if (
      (url.protocol === "http:" && url.port === "80") ||
      (url.protocol === "https:" && url.port === "443")
    ) {
      url.port = "";
    }
    let pathname = url.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }
    return `${url.protocol}//${url.host}${pathname}${url.search}`;
  } catch {
    return null;
  }
}

function collectText(article: MatchingArticleInput): string {
  return [article.title, article.summary ?? "", article.content ?? ""]
    .join("\n")
    .trim();
}

function extractVersion(text: string): string | undefined {
  const named = text.match(
    /\b((?:gpt|claude|gemini|llama|mistral|command|grok)[-\s]?\d+(?:\.\d+)?[a-z0-9-]*)\b/i,
  );
  if (named?.[1]) {
    return normalizeToken(named[1]);
  }
  const semver = text.match(/\bv?(\d+\.\d+(?:\.\d+)?(?:-[a-z0-9.]+)?)\b/i);
  if (semver?.[1]) {
    return normalizeToken(semver[1]);
  }
  return undefined;
}

function extractAnnouncementNature(text: string): AnnouncementNature {
  for (const entry of NATURE_PATTERNS) {
    if (entry.pattern.test(text)) {
      return entry.nature;
    }
  }
  return "other";
}

function extractProductOrOrg(text: string): string | undefined {
  const normalized = normalizeToken(text);
  for (const org of KNOWN_ORGS) {
    if (normalized.includes(org)) {
      return org;
    }
  }
  return undefined;
}

function extractEntities(
  text: string,
  minLength: number,
): readonly string[] {
  const entities = new Set<string>();
  const product = extractProductOrOrg(text);
  if (product) {
    entities.add(product);
  }

  const version = extractVersion(text);
  if (version) {
    entities.add(version);
  }

  const properNouns = text.match(
    /\b[A-Z][A-Za-z0-9]*(?:[-\s][A-Z][A-Za-z0-9]*){0,3}\b/g,
  );
  if (properNouns) {
    for (const raw of properNouns) {
      const token = normalizeToken(raw);
      if (token.length >= minLength && !isStopEntity(token)) {
        entities.add(token);
      }
    }
  }

  return [...entities].sort();
}

function isStopEntity(token: string): boolean {
  return (
    token === "ai" ||
    token === "the" ||
    token === "a" ||
    token === "an" ||
    token === "new" ||
    token === "update" ||
    token === "release" ||
    token === "model" ||
    token === "models" ||
    token === "why" ||
    token === "week" ||
    token === "this" ||
    token === "how" ||
    token === "what" ||
    token === "when" ||
    token === "industry" ||
    token === "notes" ||
    token === "matters"
  );
}

/** Fact keys that describe article metadata, not event substance. */
function isMetadataFactKey(key: string): boolean {
  return key.startsWith("url:") || key.startsWith("date:");
}

function extractFactKeys(
  article: MatchingArticleInput,
  nature: AnnouncementNature,
  version: string | undefined,
): MatchingEnrichmentFact[] {
  const facts: MatchingEnrichmentFact[] = [];
  const text = collectText(article);

  if (version) {
    facts.push({ key: `version:${version}`, value: version });
  }

  // Explicit event dates in prose only — not the article publishedAt metadata.
  const explicitDate = text.match(
    /\b(on|effective|starting|available)\s+(\d{4}-\d{2}-\d{2}|\d{1,2}\s+[A-Z][a-z]+\s+\d{4})\b/i,
  );
  if (explicitDate?.[2]) {
    const value = normalizeToken(explicitDate[2]);
    facts.push({ key: `event_date:${value}`, value });
  }

  if (/\b(generally\s+available|\bga\b)\b/i.test(text)) {
    facts.push({ key: "availability:ga", value: "ga" });
  }
  if (/\b(public\s+preview|preview)\b/i.test(text)) {
    facts.push({ key: "availability:preview", value: "preview" });
  }
  if (/\bwaitlist\b/i.test(text)) {
    facts.push({ key: "availability:waitlist", value: "waitlist" });
  }

  const region = text.match(
    /\b(?:available|disponible)\s+in\s+([A-Z][A-Za-z(?:\s|,|/|&)]{1,40})/i,
  );
  if (region?.[1]) {
    const value = normalizeToken(region[1]);
    facts.push({ key: `region:${value}`, value });
  }

  const price = text.match(
    /(?:\$|€|£)\s?(\d+(?:[.,]\d+)?)|(?:price[d]?|pricing)\s*(?:of|:)?\s*\$?\s?(\d+(?:[.,]\d+)?)/i,
  );
  if (price) {
    const value = normalizeToken(price[1] ?? price[2] ?? "");
    if (value) {
      facts.push({ key: `price:${value}`, value });
    }
  }

  if (/\b(delay(?:ed)?|postponed|reporté)\b/i.test(text)) {
    facts.push({ key: "status:delayed", value: "delayed" });
  }
  if (/\b(cancel(?:led|ed)?|annul[ée])\b/i.test(text)) {
    facts.push({ key: "status:cancelled", value: "cancelled" });
  }
  if (/\b(confirm(?:s|ed)?|confirmation)\b/i.test(text)) {
    facts.push({ key: "status:confirmed", value: "confirmed" });
  }

  if (nature === "denial") {
    facts.push({ key: "correction:denial", value: "denial" });
  }
  if (nature === "correction") {
    facts.push({ key: "correction:erratum", value: "correction" });
  }

  // Article canonical URL is a matching signal (canonicalUrls), not an enrichment fact.

  // Deduplicate by key (first wins).
  const seen = new Set<string>();
  const unique: MatchingEnrichmentFact[] = [];
  for (const fact of facts) {
    if (seen.has(fact.key)) {
      continue;
    }
    seen.add(fact.key);
    unique.push(fact);
  }
  return unique;
}

/**
 * Extract a deterministic event fingerprint from an article.
 * Useful both for evaluate() and for callers seeding folder fingerprints.
 */
export function extractEventFingerprint(
  article: MatchingArticleInput,
  thresholds: typeof MATCHING_THRESHOLDS = MATCHING_THRESHOLDS,
): EventFingerprint {
  const text = collectText(article);
  const version = extractVersion(text);
  const announcementNature = extractAnnouncementNature(text);
  const productOrOrg = extractProductOrOrg(text);
  const entities = extractEntities(text, thresholds.minEntityTokenLength);
  const facts = extractFactKeys(article, announcementNature, version);
  const url = canonicalizeMatchingUrl(article.url);

  return {
    entities,
    productOrOrg,
    announcementNature,
    version,
    knownFactKeys: facts.map((fact) => fact.key),
    categories: article.categories.map(normalizeToken).filter(Boolean).sort(),
    canonicalUrls: url ? [url] : [],
    referenceDate: article.publishedAt,
    bestSourceTier: article.sourceTier,
  };
}

export function extractArticleFacts(
  article: MatchingArticleInput,
): readonly MatchingEnrichmentFact[] {
  const text = collectText(article);
  const version = extractVersion(text);
  const nature = extractAnnouncementNature(text);
  return extractFactKeys(article, nature, version);
}

export function hasPrimaryInformation(
  article: MatchingArticleInput,
  fingerprint: EventFingerprint,
  thresholds: typeof MATCHING_THRESHOLDS,
): boolean {
  const text = collectText(article);
  if (text.replace(/\s+/g, " ").trim().length < thresholds.minPrimaryTextLength) {
    return false;
  }
  return (
    fingerprint.entities.length > 0 ||
    fingerprint.productOrOrg !== undefined ||
    (fingerprint.announcementNature !== undefined &&
      fingerprint.announcementNature !== "other") ||
    fingerprint.version !== undefined
  );
}

export function isTierStrictlyHigher(
  left: MatchingSourceTier,
  right: MatchingSourceTier,
): boolean {
  return SOURCE_TIER_RANK[left] > SOURCE_TIER_RANK[right];
}

export interface FingerprintComparison {
  readonly confidence: "high" | "medium" | "low" | "none";
  readonly favorableSignals: readonly string[];
  readonly unfavorableSignals: readonly string[];
  readonly blockingConflict: boolean;
  readonly clearlyDistinct: boolean;
  readonly novelFacts: readonly MatchingEnrichmentFact[];
}

function sharedCount(left: readonly string[], right: readonly string[]): number {
  const rightSet = new Set(right.map(normalizeToken));
  let count = 0;
  for (const item of left) {
    if (rightSet.has(normalizeToken(item))) {
      count += 1;
    }
  }
  return count;
}

function daysBetween(aIso: string | undefined, bIso: string | undefined): number | null {
  if (!aIso || !bIso) {
    return null;
  }
  const a = Date.parse(aIso);
  const b = Date.parse(bIso);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return null;
  }
  return Math.abs(a - b) / (1000 * 60 * 60 * 24);
}

function naturesIncompatible(
  a: AnnouncementNature | undefined,
  b: AnnouncementNature | undefined,
): boolean {
  if (!a || !b || a === "other" || b === "other") {
    return false;
  }
  if (a === b) {
    return false;
  }
  // Correction / denial can enrich the same event.
  if (a === "correction" || b === "correction" || a === "denial" || b === "denial") {
    return false;
  }
  if (a === "update" && b === "launch") {
    return false;
  }
  if (b === "update" && a === "launch") {
    return false;
  }
  if (a === "availability" && (b === "launch" || b === "update")) {
    return false;
  }
  if (b === "availability" && (a === "launch" || a === "update")) {
    return false;
  }
  return INCOMPATIBLE_NATURE_PAIRS.has(pairKey(a, b));
}

/**
 * Compare an article fingerprint (+ facts) against a folder fingerprint.
 */
export function compareFingerprints(
  article: MatchingArticleInput,
  articleFp: EventFingerprint,
  folderFp: EventFingerprint,
  thresholds: typeof MATCHING_THRESHOLDS,
): FingerprintComparison {
  const favorable: string[] = [];
  const unfavorable: string[] = [];
  let blockingConflict = false;
  let clearlyDistinct = false;

  const articleUrl = articleFp.canonicalUrls[0];
  const sameUrl =
    articleUrl !== undefined &&
    folderFp.canonicalUrls.some(
      (url) => canonicalizeMatchingUrl(url) === articleUrl,
    );
  if (sameUrl) {
    favorable.push("same_canonical_url");
  }

  const sharedEntities = sharedCount(articleFp.entities, folderFp.entities);
  const sameEntities = sharedEntities >= thresholds.minSharedEntities;
  if (sameEntities) {
    favorable.push("same_entities");
  }

  const sameProduct =
    articleFp.productOrOrg !== undefined &&
    folderFp.productOrOrg !== undefined &&
    normalizeToken(articleFp.productOrOrg) ===
      normalizeToken(folderFp.productOrOrg);
  if (sameProduct) {
    favorable.push("same_product_org");
  } else if (
    articleFp.productOrOrg &&
    folderFp.productOrOrg &&
    normalizeToken(articleFp.productOrOrg) !==
      normalizeToken(folderFp.productOrOrg)
  ) {
    unfavorable.push("different_product_org");
    blockingConflict = true;
    clearlyDistinct = true;
  }

  const sameNature =
    articleFp.announcementNature !== undefined &&
    folderFp.announcementNature !== undefined &&
    articleFp.announcementNature === folderFp.announcementNature &&
    articleFp.announcementNature !== "other";
  if (sameNature) {
    favorable.push("same_announcement_nature");
  }

  if (
    naturesIncompatible(
      articleFp.announcementNature,
      folderFp.announcementNature,
    )
  ) {
    unfavorable.push("incompatible_announcement_nature");
    blockingConflict = true;
    clearlyDistinct = true;
  }

  const sameVersion =
    articleFp.version !== undefined &&
    folderFp.version !== undefined &&
    normalizeToken(articleFp.version) === normalizeToken(folderFp.version);
  if (sameVersion) {
    favorable.push("same_version");
  } else if (
    articleFp.version &&
    folderFp.version &&
    normalizeToken(articleFp.version) !== normalizeToken(folderFp.version)
  ) {
    unfavorable.push("different_version");
    blockingConflict = true;
    clearlyDistinct = true;
  }

  const categoryOverlap = sharedCount(
    articleFp.categories,
    folderFp.categories,
  );
  if (categoryOverlap > 0) {
    favorable.push("category_overlap");
  }

  const proximityDays = daysBetween(
    article.publishedAt ?? articleFp.referenceDate,
    folderFp.referenceDate,
  );
  if (
    proximityDays !== null &&
    proximityDays <= thresholds.temporalProximityDays
  ) {
    favorable.push("temporal_proximity");
  }

  if (
    folderFp.bestSourceTier &&
    isTierStrictlyHigher(article.sourceTier, folderFp.bestSourceTier)
  ) {
    favorable.push("higher_source_tier");
  }

  // Strong identity divergence (product/version already handled). Entity-only
  // divergence is blocking+distinct only when at least one side has a product/version.
  const hasStrongIdentity =
    articleFp.productOrOrg !== undefined ||
    folderFp.productOrOrg !== undefined ||
    articleFp.version !== undefined ||
    folderFp.version !== undefined;
  if (
    !sameEntities &&
    !sameProduct &&
    hasStrongIdentity &&
    articleFp.entities.length > 0 &&
    folderFp.entities.length > 0 &&
    sharedEntities === 0
  ) {
    unfavorable.push("different_entities");
    blockingConflict = true;
    clearlyDistinct = true;
  }

  const articleFacts = extractArticleFacts(article);
  const known = new Set(folderFp.knownFactKeys.map(normalizeToken));
  const novelFacts = articleFacts.filter(
    (fact) =>
      !isMetadataFactKey(fact.key) && !known.has(normalizeToken(fact.key)),
  );

  // URL-only / category-only / temporal-only are insufficient alone (gel §5.3).
  const strongCore =
    sameUrl ||
    (sameEntities && sameNature && sameVersion) ||
    (sameProduct && sameNature && sameVersion) ||
    (sameEntities && sameVersion && sameProduct);

  const mediumCore =
    (sameEntities && sameNature) ||
    (sameEntities && sameVersion) ||
    (sameProduct && sameNature && favorable.includes("temporal_proximity")) ||
    (sameUrl && !blockingConflict);

  let confidence: FingerprintComparison["confidence"] = "none";
  if (blockingConflict) {
    confidence = clearlyDistinct ? "none" : "low";
  } else if (strongCore || (sameUrl && sameEntities)) {
    confidence = "high";
  } else if (mediumCore) {
    confidence = "medium";
  } else if (
    sameEntities ||
    sameProduct ||
    categoryOverlap > 0 ||
    favorable.includes("temporal_proximity")
  ) {
    confidence = "low";
    if (!sameEntities && !sameProduct && !sameNature && !sameVersion && !sameUrl) {
      unfavorable.push("theme_or_category_only");
    }
  }

  // Reinforce: lexical theme without event identity stays low.
  if (
    confidence !== "none" &&
    !sameUrl &&
    !sameEntities &&
    !sameProduct &&
    !sameNature &&
    !sameVersion
  ) {
    confidence = "low";
    unfavorable.push("insufficient_event_identity");
  }

  return {
    confidence,
    favorableSignals: [...new Set(favorable)].sort(),
    unfavorableSignals: [...new Set(unfavorable)].sort(),
    blockingConflict,
    clearlyDistinct,
    novelFacts,
  };
}

export function suggestFolderTitle(article: MatchingArticleInput): string {
  return article.title.trim().replace(/\s+/g, " ");
}

export function enrichmentTypeFor(
  nature: AnnouncementNature | undefined,
  novelFacts: readonly MatchingEnrichmentFact[],
): string {
  if (nature === "denial" || nature === "correction") {
    return "correction";
  }
  if (novelFacts.some((fact) => fact.key.startsWith("status:"))) {
    return "status_change";
  }
  if (novelFacts.some((fact) => fact.key.startsWith("availability:"))) {
    return "availability";
  }
  if (novelFacts.some((fact) => fact.key.startsWith("confirmation") || fact.key === "status:confirmed")) {
    return "confirmation";
  }
  if (novelFacts.some((fact) => fact.key.startsWith("version:"))) {
    return "version";
  }
  return "fact_update";
}
