import type {
  AnalysisArticleInput,
  EnrichmentFactInput,
} from "./analysis-service-types.js";
import { unicodeLength } from "./validate-analysis-proposal.js";

/** Budgets gel 007.1A §6.3. */
export const CONTEXT_BODY_MAX_CHARS = 12_000;
export const CONTEXT_ARTICLE_MAX_CHARS = 3_000;
export const CONTEXT_FACTS_MAX_CHARS = 2_000;

export interface AnalysisContextInput {
  readonly folderId: string;
  readonly folderTitle: string;
  readonly articles: readonly AnalysisArticleInput[];
  readonly enrichmentFacts: readonly EnrichmentFactInput[];
}

export interface BuiltAnalysisContext {
  readonly ok: true;
  /** Corps texte assemblé (hors instructions system). */
  readonly bodyText: string;
  /** Texte d’agrégat pour ancrage des faits (articles + faits + titre). */
  readonly aggregateAnchorText: string;
  readonly totalBodyChars: number;
  readonly articleBodies: readonly ArticleBodySlice[];
  readonly factsText: string;
}

export interface ContextTooLargeResult {
  readonly ok: false;
  readonly reason: "context_too_large";
  readonly totalBodyChars: number;
}

export type BuildAnalysisContextResult =
  | BuiltAnalysisContext
  | ContextTooLargeResult;

interface ArticleBodySlice {
  readonly articleId: string;
  readonly role: "primary" | "enrichment";
  readonly sourceTier: string;
  readonly title: string;
  readonly url: string;
  body: string;
  readonly attachedAtMs: number;
}

function toMs(value: string | Date): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function truncateToCodePoints(value: string, max: number): string {
  if (unicodeLength(value) <= max) {
    return value;
  }
  return [...value].slice(0, max).join("");
}

function articleRawBody(article: AnalysisArticleInput): string {
  const summary = (article.summary ?? "").trim();
  const content = (article.content ?? "").trim();
  if (summary.length === 0) return content;
  if (content.length === 0) return summary;
  return `${summary}\n${content}`;
}

function serializeFacts(facts: readonly EnrichmentFactInput[]): string {
  return facts
    .map((fact) => `${fact.key.trim()}=${fact.value.trim()}`)
    .filter((pair) => pair !== "=")
    .join("\n");
}

/**
 * Priorité de conservation des faits lors de la réduction :
 * dates, versions, disponibilité d’abord.
 */
function prioritizeFactsForTruncation(
  facts: readonly EnrichmentFactInput[],
): EnrichmentFactInput[] {
  const priorityScore = (key: string): number => {
    const k = key.toLowerCase();
    if (/(date|when|released|published|avail)/.test(k)) return 0;
    if (/(version|ver|v\d)/.test(k)) return 1;
    if (/(disponib|availability|ga|preview)/.test(k)) return 2;
    return 3;
  };
  return [...facts].sort((a, b) => {
    const diff = priorityScore(a.key) - priorityScore(b.key);
    if (diff !== 0) return diff;
    return a.key.localeCompare(b.key);
  });
}

function truncateFactsText(
  facts: readonly EnrichmentFactInput[],
  maxChars: number,
): string {
  const ordered = prioritizeFactsForTruncation(facts);
  const kept: string[] = [];
  let used = 0;
  for (const fact of ordered) {
    const line = `${fact.key.trim()}=${fact.value.trim()}`;
    const lineLen = unicodeLength(line) + (kept.length > 0 ? 1 : 0);
    if (used + lineLen > maxChars) {
      break;
    }
    kept.push(line);
    used += lineLen;
  }
  return kept.join("\n");
}

function renderBody(
  folderId: string,
  folderTitle: string,
  articles: readonly ArticleBodySlice[],
  factsText: string,
): string {
  const articleBlocks = articles.map((article) => {
    const header = [
      `articleId=${article.articleId}`,
      `role=${article.role}`,
      `tier=${article.sourceTier}`,
      `title=${article.title}`,
      `url=${article.url}`,
    ].join("\n");
    if (article.body.length === 0) {
      return header;
    }
    return `${header}\nbody:\n${article.body}`;
  });

  const parts = [
    `folderId=${folderId}`,
    `folderTitle=${folderTitle}`,
    "",
    "## Articles",
    articleBlocks.join("\n\n"),
  ];

  if (factsText.length > 0) {
    parts.push("", "## Faits d'enrichissement retenus", factsText);
  }

  return parts.join("\n");
}

/**
 * Assemble le contexte borné (gel 007.1A §6.3–§6.4).
 *
 * Ordre de réduction :
 * 1. articles d’enrichissement du plus ancien au plus récent ;
 * 2. contenu primary au-delà de 3 000 ;
 * 3. sérialisation des faits retenus ;
 * 4. si encore trop grand → `context_too_large` (pas d’appel LLM).
 *
 * Toujours conserver : folderId, titre, articleId, URL, tier.
 */
export function buildAnalysisContext(
  input: AnalysisContextInput,
): BuildAnalysisContextResult {
  const slices: ArticleBodySlice[] = input.articles.map((article) => {
    const raw = articleRawBody(article);
    const capped = truncateToCodePoints(raw, CONTEXT_ARTICLE_MAX_CHARS);
    return {
      articleId: article.articleId,
      role: article.role,
      sourceTier: article.sourceTier,
      title: article.title,
      url: article.url,
      body: capped,
      attachedAtMs: toMs(article.attachedAt),
    };
  });

  let factsText = truncateFactsText(
    input.enrichmentFacts,
    CONTEXT_FACTS_MAX_CHARS,
  );

  const measure = (): { text: string; chars: number } => {
    const text = renderBody(
      input.folderId,
      input.folderTitle,
      slices,
      factsText,
    );
    return { text, chars: unicodeLength(text) };
  };

  let current = measure();
  if (current.chars <= CONTEXT_BODY_MAX_CHARS) {
    return success(input, slices, factsText, current);
  }

  // 1. Réduire enrichissements du plus ancien au plus récent (garder meta).
  const enrichments = slices
    .filter((s) => s.role === "enrichment")
    .sort((a, b) => a.attachedAtMs - b.attachedAtMs);

  for (const enrichment of enrichments) {
    if (current.chars <= CONTEXT_BODY_MAX_CHARS) break;
    enrichment.body = "";
    current = measure();
  }

  // 2. Réduire le primary au-delà (déjà capped à 3000 ; vider progressivement).
  if (current.chars > CONTEXT_BODY_MAX_CHARS) {
    const primary = slices.find((s) => s.role === "primary");
    if (primary && primary.body.length > 0) {
      // Réduction agressive : conserver uniquement meta (titre/URL/tier).
      primary.body = "";
      current = measure();
    }
  }

  // 3. Réduire les faits.
  if (current.chars > CONTEXT_BODY_MAX_CHARS) {
    let budget = CONTEXT_FACTS_MAX_CHARS;
    while (budget > 0 && current.chars > CONTEXT_BODY_MAX_CHARS) {
      budget = Math.floor(budget / 2);
      factsText = truncateFactsText(input.enrichmentFacts, budget);
      current = measure();
    }
    if (current.chars > CONTEXT_BODY_MAX_CHARS) {
      factsText = "";
      current = measure();
    }
  }

  if (current.chars > CONTEXT_BODY_MAX_CHARS) {
    return {
      ok: false,
      reason: "context_too_large",
      totalBodyChars: current.chars,
    };
  }

  return success(input, slices, factsText, current);
}

function success(
  input: AnalysisContextInput,
  slices: readonly ArticleBodySlice[],
  factsText: string,
  current: { text: string; chars: number },
): BuiltAnalysisContext {
  const anchorParts = [
    input.folderTitle,
    ...slices.map(
      (s) => `${s.title}\n${s.url}\n${s.body}`.trim(),
    ),
    factsText,
  ];

  return {
    ok: true,
    bodyText: current.text,
    aggregateAnchorText: anchorParts.filter((p) => p.length > 0).join("\n"),
    totalBodyChars: current.chars,
    articleBodies: slices,
    factsText,
  };
}
