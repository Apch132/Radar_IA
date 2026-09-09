import type {
  AnalysisCategory,
  AnalysisProposalV1,
  AnnouncementNature,
  ChannelRoleHint,
  PublishWorthiness,
} from "./analysis-proposal-types.js";
import type {
  AnalysisArticleInput,
  BackendScoringV1,
  ChannelSalonHint,
  SourceTier,
} from "./analysis-service-types.js";
import {
  computeBackendScoring,
  resolveBestSourceTier,
} from "./analysis-scoring.js";
import {
  isOfficialWhitelistSource,
  OFFICIAL_WHITELIST_SOURCE_IDS,
} from "./official-whitelist.js";

export type DecisionMethod = "llm_analysis" | "deterministic_fallback";

/** @deprecated Prefer OFFICIAL_WHITELIST_SOURCE_IDS — kept for Correctif 1 callers. */
export const DETERMINISTIC_FALLBACK_SOURCE_IDS = OFFICIAL_WHITELIST_SOURCE_IDS;

export type DeterministicFallbackSourceId =
  (typeof DETERMINISTIC_FALLBACK_SOURCE_IDS)[number];


const MAJOR_PHRASE_PATTERNS: readonly RegExp[] = [
  /\bintroducing\b/i,
  /\bannouncing\b/i,
  /\bannounce(?:s|d|ment)?\b/i,
  /\bnow available\b/i,
  /\blaunch(?:es|ed|ing)?\b/i,
  /\breleased?\b/i,
  /\brelease\b/i,
  /\bnew model\b/i,
  /\bmodel card\b/i,
  /\bgenerally available\b/i,
  /\bga\b/i,
];

const MAJOR_MODEL_PATTERNS: readonly RegExp[] = [
  /\b(?:gpt|chatgpt)[-\s]?\d/i,
  /\b(?:claude|sonnet|opus|haiku)\b/i,
  /\bgemini\b/i,
  /\bgrok\b/i,
  /\bllama[-\s]?\d/i,
  /\bqwen\b/i,
  /\bmistral\b/i,
  /\bdeepseek\b/i,
  /\bgemma\b/i,
  /\bphi[-\s]?\d/i,
  /\bolmo\b/i,
  /\bkimi\b/i,
  /\bcursor\b/i,
  /\bwindsurf\b/i,
  /\bollama\b/i,
  /\bvllm\b/i,
  /\bopen[-\s]?weight/i,
];

const TOOL_VERSION_PATTERNS: readonly RegExp[] = [
  /\bcursor\b.+\b(?:\d+\.\d+|changelog|update|release)/i,
  /\b(?:ollama|vllm|llama\.cpp|mlx)\b.+\b(?:\d+\.\d+|release|released)/i,
];

export type DeterministicFallbackInput = {
  readonly articles: readonly AnalysisArticleInput[];
  readonly hasMainPublication: boolean;
  readonly folderTitle?: string;
};

export type DeterministicFallbackMatch = {
  readonly matched: true;
  readonly ruleId: string;
  readonly decisionMethod: "deterministic_fallback";
  readonly decision: "publish";
  readonly channelHint: ChannelSalonHint;
  readonly proposal: AnalysisProposalV1;
  readonly backendScoring: BackendScoringV1;
  readonly primaryArticleId: string;
  readonly sourceIds: readonly string[];
};

export type DeterministicFallbackMiss = {
  readonly matched: false;
  readonly reason:
    | "has_main_publication"
    | "no_articles"
    | "source_not_whitelisted"
    | "not_major_announcement";
};

export type DeterministicFallbackResult =
  | DeterministicFallbackMatch
  | DeterministicFallbackMiss;

function isWhitelistedSource(
  sourceId: string,
  sourceTier: SourceTier,
): boolean {
  if (isOfficialWhitelistSource(sourceId)) {
    return true;
  }
  // Tier S official feeds not yet listed remain eligible (forward-compatible).
  return sourceTier === "S";
}

function combinedText(article: AnalysisArticleInput, folderTitle?: string): string {
  return [
    folderTitle ?? "",
    article.title,
    article.summary ?? "",
    article.content ?? "",
  ].join("\n");
}

function detectRule(
  text: string,
): { ruleId: string; category: AnalysisCategory; nature: AnnouncementNature } | null {
  const hasPhrase = MAJOR_PHRASE_PATTERNS.some((pattern) => pattern.test(text));
  const hasModel = MAJOR_MODEL_PATTERNS.some((pattern) => pattern.test(text));
  const hasToolVersion = TOOL_VERSION_PATTERNS.some((pattern) =>
    pattern.test(text),
  );

  if (hasModel && hasPhrase) {
    return {
      ruleId: "major_model_announcement",
      category: "model_release",
      nature: "launch",
    };
  }
  if (hasToolVersion || (hasPhrase && /\bcursor\b|\bollama\b|\bvllm\b/i.test(text))) {
    return {
      ruleId: "major_tool_release",
      category: "product_update",
      nature: "launch",
    };
  }
  if (hasModel && /\bopen[-\s]?weight|\bopen[-\s]?source|\brelease/i.test(text)) {
    return {
      ruleId: "open_weight_release",
      category: "open_source",
      nature: "availability",
    };
  }
  if (hasPhrase && hasModel) {
    return {
      ruleId: "major_phrase_model",
      category: "model_release",
      nature: "launch",
    };
  }
  // Strong title-only signal: "Introducing X" / "Announcing X" on Tier S.
  if (hasPhrase && text.length >= 24) {
    return {
      ruleId: "official_introducing_phrase",
      category: "product_update",
      nature: "launch",
    };
  }
  return null;
}

function buildSummary(title: string, ruleId: string): string {
  const base = `Annonce officielle majeure détectée (mode dégradé, règle ${ruleId}) : ${title}`.trim();
  if (base.length >= 40) {
    return base.slice(0, 500);
  }
  return `${base} — publication déterministe sans analyse LLM complète.`;
}

function mapChannel(composite: number, category: AnalysisCategory): ChannelSalonHint {
  if (composite >= 85 && (category === "model_release" || category === "open_source")) {
    return "annonces_majeures";
  }
  if (composite >= 85) {
    return "annonces_majeures";
  }
  return "veille_pertinente";
}

/**
 * Deterministic Level-1 fallback for official major announcements.
 * Never mirrors the full RSS feed — only strong, explainable signals.
 */
export function evaluateDeterministicFallback(
  input: DeterministicFallbackInput,
): DeterministicFallbackResult {
  if (input.hasMainPublication) {
    return { matched: false, reason: "has_main_publication" };
  }
  if (input.articles.length === 0) {
    return { matched: false, reason: "no_articles" };
  }

  const primary =
    input.articles.find((article) => article.role === "primary") ??
    input.articles[0]!;

  const sourceId = primary.sourceId;
  if (
    sourceId !== undefined &&
    !isWhitelistedSource(sourceId, primary.sourceTier)
  ) {
    return { matched: false, reason: "source_not_whitelisted" };
  }
  if (sourceId === undefined && primary.sourceTier !== "S") {
    return { matched: false, reason: "source_not_whitelisted" };
  }

  const text = combinedText(primary, input.folderTitle);
  const titleText = primary.title;
  const rule =
    detectRule(`${titleText}\n${text}`) ?? detectRule(titleText);
  if (rule === null) {
    return { matched: false, reason: "not_major_announcement" };
  }

  const bestSourceTier = resolveBestSourceTier(
    input.articles.map((article) => article.sourceTier),
  );
  const publishWorthiness: PublishWorthiness = "high";
  const suggestedChannelRole: ChannelRoleHint =
    rule.category === "model_release" || rule.category === "open_source"
      ? "annonces_majeures"
      : "veille_pertinente";

  const proposal: AnalysisProposalV1 = {
    schemaVersion: "1",
    summary: buildSummary(primary.title, rule.ruleId),
    classification: {
      primaryCategory: rule.category,
      secondaryCategories: [],
      announcementNature: rule.nature,
    },
    scoring: {
      relevance: 90,
      impact: 88,
      novelty: 85,
      confidence: 0.7,
    },
    entities: [],
    proposedFacts: [
      {
        key: "deterministic_rule",
        value: rule.ruleId,
        support: "explicit",
      },
    ],
    editorialProposal: {
      publishWorthiness,
      suggestedChannelRole,
    },
    rationale: `Deterministic fallback matched rule ${rule.ruleId} on official source (tier ${bestSourceTier}).`,
  };

  const backendScoring = computeBackendScoring({
    relevance: proposal.scoring.relevance,
    impact: proposal.scoring.impact,
    novelty: proposal.scoring.novelty,
    confidence: proposal.scoring.confidence,
    bestSourceTier,
  });

  const channelHint = mapChannel(
    backendScoring.composite,
    rule.category,
  );

  const sourceIds = [
    ...new Set(
      input.articles
        .map((article) => article.sourceId)
        .filter((value): value is string => typeof value === "string"),
    ),
  ];

  return {
    matched: true,
    ruleId: rule.ruleId,
    decisionMethod: "deterministic_fallback",
    decision: "publish",
    channelHint,
    proposal,
    backendScoring,
    primaryArticleId: primary.articleId,
    sourceIds,
  };
}

export function isDeterministicFallbackSourceId(sourceId: string): boolean {
  return isOfficialWhitelistSource(sourceId);
}
