import {
  compareFingerprints,
  enrichmentTypeFor,
  extractEventFingerprint,
  hasPrimaryInformation,
  suggestFolderTitle,
} from "./matching-signals.js";
import { MATCHING_THRESHOLDS } from "./matching-thresholds.js";
import type {
  MatchingArticleInput,
  MatchingCandidateFolder,
  MatchingEngine,
  MatchingEngineOptions,
  MatchingEvaluationResult,
} from "./matching-types.js";

interface ScoredCandidate {
  readonly folder: MatchingCandidateFolder;
  readonly confidence: "high" | "medium" | "low" | "none";
  readonly favorableSignals: readonly string[];
  readonly unfavorableSignals: readonly string[];
  readonly blockingConflict: boolean;
  readonly clearlyDistinct: boolean;
  readonly novelFacts: ReturnType<typeof compareFingerprints>["novelFacts"];
}

function mergeThresholds(
  overrides: MatchingEngineOptions["thresholds"],
): typeof MATCHING_THRESHOLDS {
  if (!overrides) {
    return MATCHING_THRESHOLDS;
  }
  return {
    ...MATCHING_THRESHOLDS,
    ...overrides,
  };
}

function buildJustification(result: {
  issue: MatchingEvaluationResult["issue"];
  confidence: MatchingEvaluationResult["confidence"];
  folderId: string | null;
  motiveCodes: readonly string[];
  favorableSignals: readonly string[];
  unfavorableSignals: readonly string[];
}): string {
  const parts = [
    `issue=${result.issue}`,
    `confidence=${result.confidence}`,
    result.folderId ? `folder=${result.folderId}` : "folder=none",
    `motives=${result.motiveCodes.join(",") || "none"}`,
    `favorable=${result.favorableSignals.join(",") || "none"}`,
    `unfavorable=${result.unfavorableSignals.join(",") || "none"}`,
  ];
  return parts.join("; ");
}

function rankConfidence(
  confidence: ScoredCandidate["confidence"],
): number {
  switch (confidence) {
    case "high":
      return 3;
    case "medium":
      return 2;
    case "low":
      return 1;
    default:
      return 0;
  }
}

/**
 * Create a pure deterministic matching engine (006.1D).
 * No Prisma, Fastify, Discord, LLM, network, or mutable state.
 */
export function createMatchingEngine(
  options: MatchingEngineOptions = {},
): MatchingEngine {
  const thresholds = mergeThresholds(options.thresholds);

  return {
    evaluate(article, candidateFolders) {
      return evaluateArticle(article, candidateFolders, thresholds);
    },
  };
}

function evaluateArticle(
  article: MatchingArticleInput,
  candidateFolders: readonly MatchingCandidateFolder[],
  thresholds: typeof MATCHING_THRESHOLDS,
): MatchingEvaluationResult {
  const articleFp = extractEventFingerprint(article, thresholds);
  const primary = hasPrimaryInformation(article, articleFp, thresholds);

  if (!primary) {
    return finalize({
      issue: "ambiguous_no_action",
      folderId: null,
      confidence: "low",
      motiveCodes: ["insufficient_primary_information"],
      favorableSignals: [],
      unfavorableSignals: ["content_too_thin"],
      enrichmentFacts: null,
      enrichmentType: null,
      folderTitle: null,
    });
  }

  const scored: ScoredCandidate[] = [];
  for (const folder of candidateFolders) {
    if (folder.status === "closed") {
      continue;
    }
    const comparison = compareFingerprints(
      article,
      articleFp,
      folder.fingerprint,
      thresholds,
    );
    scored.push({
      folder,
      confidence: comparison.confidence,
      favorableSignals: comparison.favorableSignals,
      unfavorableSignals: comparison.unfavorableSignals,
      blockingConflict: comparison.blockingConflict,
      clearlyDistinct: comparison.clearlyDistinct,
      novelFacts: comparison.novelFacts,
    });
  }

  scored.sort((left, right) => {
    const byConfidence =
      rankConfidence(right.confidence) - rankConfidence(left.confidence);
    if (byConfidence !== 0) {
      return byConfidence;
    }
    return left.folder.id.localeCompare(right.folder.id);
  });

  const attachable = scored.filter(
    (entry) =>
      !entry.blockingConflict &&
      (entry.confidence === "high" || entry.confidence === "medium"),
  );

  if (attachable.length > 1) {
    const top = attachable[0]!;
    const tied = attachable.filter(
      (entry) => entry.confidence === top.confidence,
    );
    if (tied.length > 1) {
      return finalize({
        issue: "ambiguous_no_action",
        folderId: null,
        confidence: "low",
        motiveCodes: ["multiple_plausible_folders"],
        favorableSignals: uniqueSignals(tied.flatMap((e) => e.favorableSignals)),
        unfavorableSignals: uniqueSignals([
          ...tied.flatMap((e) => e.unfavorableSignals),
          "conflicting_candidate_folders",
        ]),
        enrichmentFacts: null,
        enrichmentType: null,
        folderTitle: null,
      });
    }
  }

  if (attachable.length >= 1) {
    const best = attachable[0]!;
    if (best.novelFacts.length > 0) {
      return finalize({
        issue: "attach_enrich",
        folderId: best.folder.id,
        confidence: best.confidence,
        motiveCodes: ["same_event", "novel_information"],
        favorableSignals: best.favorableSignals,
        unfavorableSignals: best.unfavorableSignals,
        enrichmentFacts: best.novelFacts,
        enrichmentType: enrichmentTypeFor(
          articleFp.announcementNature,
          best.novelFacts,
        ),
        folderTitle: null,
      });
    }
    return finalize({
      issue: "duplicate_editorial",
      folderId: best.folder.id,
      confidence: best.confidence,
      motiveCodes: ["same_event", "no_novel_information"],
      favorableSignals: best.favorableSignals,
      unfavorableSignals: uniqueSignals([
        ...best.unfavorableSignals,
        "absence_of_new_value",
      ]),
      enrichmentFacts: null,
      enrichmentType: null,
      folderTitle: null,
    });
  }

  const lowOnly = scored.filter(
    (entry) => entry.confidence === "low" && !entry.clearlyDistinct,
  );
  if (lowOnly.length > 0) {
    const bestLow = lowOnly[0]!;
    return finalize({
      issue: "ambiguous_no_action",
      folderId: bestLow.folder.id,
      confidence: "low",
      motiveCodes: ["low_confidence_match"],
      favorableSignals: bestLow.favorableSignals,
      unfavorableSignals: uniqueSignals([
        ...bestLow.unfavorableSignals,
        "insufficient_event_identity",
      ]),
      enrichmentFacts: null,
      enrichmentType: null,
      folderTitle: null,
    });
  }

  const blockedDistinct = scored.filter(
    (entry) => entry.blockingConflict && entry.clearlyDistinct,
  );
  const unclearConflicts = scored.filter(
    (entry) => entry.blockingConflict && !entry.clearlyDistinct,
  );

  if (unclearConflicts.length > 0 && blockedDistinct.length === 0) {
    const conflict = unclearConflicts[0]!;
    return finalize({
      issue: "ambiguous_no_action",
      folderId: conflict.folder.id,
      confidence: "low",
      motiveCodes: ["blocking_signal_conflict"],
      favorableSignals: conflict.favorableSignals,
      unfavorableSignals: conflict.unfavorableSignals,
      enrichmentFacts: null,
      enrichmentType: null,
      folderTitle: null,
    });
  }

  // No credible same-event candidate (empty list, or only clearly distinct events).
  return finalize({
    issue: "create_dossier",
    folderId: null,
    confidence: "none",
    motiveCodes:
      blockedDistinct.length > 0
        ? ["distinct_event", "primary_information"]
        : ["no_credible_candidate", "primary_information"],
    favorableSignals: [],
    unfavorableSignals: uniqueSignals(
      blockedDistinct.flatMap((entry) => entry.unfavorableSignals),
    ),
    enrichmentFacts: null,
    enrichmentType: null,
    folderTitle: suggestFolderTitle(article),
  });
}

function uniqueSignals(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function finalize(
  partial: Omit<
    MatchingEvaluationResult,
    "justification" | "proposalOrigin" | "reevaluable"
  >,
): MatchingEvaluationResult {
  return {
    ...partial,
    proposalOrigin: "rule",
    reevaluable: true,
    justification: buildJustification(partial),
  };
}
