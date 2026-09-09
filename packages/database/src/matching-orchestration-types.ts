import type {
  MatchingArticleInput,
  MatchingCandidateFolder,
  MatchingEvaluationResult,
} from "@radar-ia/shared";

import type { PersistMatchingDecisionResult } from "./matching-persistence-types.js";

/**
 * Input for one orchestration pass: engine evaluation then persistence.
 * Candidates are always supplied by the caller (no search).
 */
export interface MatchingOrchestrationInput {
  articleId: string;
  article: MatchingArticleInput;
  candidateFolders: readonly MatchingCandidateFolder[];
  decidedAt?: Date;
}

/**
 * Coherent business result: engine proposal + transactional persistence outcome.
 */
export interface MatchingOrchestrationResult {
  proposal: MatchingEvaluationResult;
  persistence: PersistMatchingDecisionResult;
}

/**
 * Raised when an engine proposal cannot be mapped to a persistence command
 * (contract violation between 006.1D and 006.1C).
 */
export class MatchingOrchestrationError extends Error {
  readonly code = "MATCHING_ORCHESTRATION";

  constructor(message: string) {
    super(message);
    this.name = "MatchingOrchestrationError";
  }
}
