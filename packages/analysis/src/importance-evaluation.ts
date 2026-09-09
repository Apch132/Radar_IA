import type { AnalysisArticleInput, SourceTier } from "./analysis-service-types.js";
import {
  isOfficialWhitelistSource,
  resolveOfficialPublisher,
  type OfficialPublisher,
} from "./official-whitelist.js";

/** Deterministic importance ladder evaluated before any LLM call. */
export type ImportanceLevel = "critical" | "high" | "medium" | "low";

export type ImportanceSignal =
  | "official_publisher"
  | "tier_s"
  | "tier_a"
  | "new_model"
  | "new_family"
  | "official_announcement"
  | "general_availability"
  | "launch";

export type ImportanceEvaluation = {
  readonly level: ImportanceLevel;
  readonly signals: readonly ImportanceSignal[];
  readonly officialPublisher: OfficialPublisher | null;
  readonly primaryArticleId: string | null;
  readonly sourceId: string | null;
  readonly sourceTier: SourceTier | null;
};

export type ImportanceInput = {
  readonly articles: readonly AnalysisArticleInput[];
  readonly folderTitle?: string;
};

const NEW_MODEL_PATTERNS: readonly RegExp[] = [
  /\b(?:gpt|chatgpt)[-\s]?\d/i,
  /\bclaude\b.+\b(?:opus|sonnet|haiku)\b/i,
  /\b(?:opus|sonnet|haiku)\s*\d/i,
  /\bgemini\b.+\b(?:\d|ultra|pro|flash|nano)/i,
  /\bgemini\s*\d/i,
  /\bllama[-\s]?\d/i,
  /\bqwen[-\s]?\d/i,
  /\bmistral\b.+\b(?:large|small|medium|nemo|next)/i,
  /\bmixtral\b/i,
  /\bdeepseek[-\s]?(?:r\d|v\d|\d)/i,
  /\bgemma[-\s]?\d/i,
  /\bphi[-\s]?\d/i,
  /\bolmo[-\s]?\d/i,
  /\bnew model\b/i,
];

const NEW_FAMILY_PATTERNS: readonly RegExp[] = [
  /\bnew (?:model )?family\b/i,
  /\bfamily of models\b/i,
  /\bintroducing (?:the )?[\w.-]+ (?:family|series|line)\b/i,
  /\b(?:gpt|claude|gemini|llama|qwen|mistral|deepseek)\b.+\bfamily\b/i,
];

const OFFICIAL_ANNOUNCEMENT_PATTERNS: readonly RegExp[] = [
  /\bintroducing\b/i,
  /\bannouncing\b/i,
  /\bannounce(?:s|d|ment)?\b/i,
  /\bofficial(?:ly)?\b/i,
];

const GA_PATTERNS: readonly RegExp[] = [
  /\bgenerally available\b/i,
  /\bgeneral availability\b/i,
  /\bnow available\b/i,
  /\b\bga\b/i,
  /\bpublic(?:ly)? available\b/i,
];

const LAUNCH_PATTERNS: readonly RegExp[] = [
  /\blaunch(?:es|ed|ing)?\b/i,
  /\breleased?\b/i,
  /\brelease\b/i,
  /\bunveils?\b/i,
];

function combinedText(
  article: AnalysisArticleInput,
  folderTitle?: string,
): string {
  return [
    folderTitle ?? "",
    article.title,
    article.summary ?? "",
    article.content ?? "",
  ].join("\n");
}

function anyMatch(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function rankLevel(level: ImportanceLevel): number {
  switch (level) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default: {
      const exhaustive: never = level;
      return exhaustive;
    }
  }
}

/**
 * Evaluate deterministic importance BEFORE any LLM inference.
 * Critical majors from official publishers must remain publishable without Ollama.
 */
export function evaluateImportance(input: ImportanceInput): ImportanceEvaluation {
  if (input.articles.length === 0) {
    return {
      level: "low",
      signals: [],
      officialPublisher: null,
      primaryArticleId: null,
      sourceId: null,
      sourceTier: null,
    };
  }

  const primary =
    input.articles.find((article) => article.role === "primary") ??
    input.articles[0]!;

  const text = combinedText(primary, input.folderTitle);
  const signals: ImportanceSignal[] = [];
  const official = isOfficialWhitelistSource(primary.sourceId);
  const publisher = resolveOfficialPublisher(primary.sourceId);

  if (official) {
    signals.push("official_publisher");
  }
  if (primary.sourceTier === "S") {
    signals.push("tier_s");
  } else if (primary.sourceTier === "A") {
    signals.push("tier_a");
  }

  const hasNewModel = anyMatch(text, NEW_MODEL_PATTERNS);
  const hasNewFamily = anyMatch(text, NEW_FAMILY_PATTERNS);
  const hasOfficialAnnouncement = anyMatch(text, OFFICIAL_ANNOUNCEMENT_PATTERNS);
  const hasGa = anyMatch(text, GA_PATTERNS);
  const hasLaunch = anyMatch(text, LAUNCH_PATTERNS);

  if (hasNewModel) {
    signals.push("new_model");
  }
  if (hasNewFamily) {
    signals.push("new_family");
  }
  if (hasOfficialAnnouncement) {
    signals.push("official_announcement");
  }
  if (hasGa) {
    signals.push("general_availability");
  }
  if (hasLaunch) {
    signals.push("launch");
  }

  const majorSignal =
    hasNewModel || hasNewFamily || (hasOfficialAnnouncement && (hasGa || hasLaunch));

  let level: ImportanceLevel = "low";

  if (
    official &&
    (primary.sourceTier === "S" || primary.sourceTier === "A") &&
    majorSignal
  ) {
    level = "critical";
  } else if (
    official &&
    (hasOfficialAnnouncement || hasLaunch || hasGa || hasNewModel)
  ) {
    level = "high";
  } else if (primary.sourceTier === "S" || primary.sourceTier === "A") {
    level = majorSignal || hasOfficialAnnouncement ? "high" : "medium";
  } else if (hasOfficialAnnouncement || hasLaunch) {
    level = "medium";
  }

  // Prefer higher of title-only strong model launches on whitelist.
  if (
    official &&
    hasNewModel &&
    (hasOfficialAnnouncement || hasLaunch || hasGa) &&
    rankLevel(level) < rankLevel("critical")
  ) {
    level = "critical";
  }

  return {
    level,
    signals,
    officialPublisher: publisher,
    primaryArticleId: primary.articleId,
    sourceId: primary.sourceId ?? null,
    sourceTier: primary.sourceTier,
  };
}

export function isCriticalImportance(level: ImportanceLevel): boolean {
  return level === "critical";
}
