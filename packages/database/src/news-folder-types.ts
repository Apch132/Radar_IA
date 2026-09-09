import type {
  MatchingConfidence,
  MatchingDecision,
  MatchingDecisionIssue,
  NewsFolder,
  NewsFolderArticle,
  NewsFolderArticleRole,
  NewsFolderStatus,
  Prisma,
} from "@prisma/client";

export type {
  MatchingConfidence,
  MatchingDecision,
  MatchingDecisionIssue,
  NewsFolder,
  NewsFolderArticle,
  NewsFolderArticleRole,
  NewsFolderStatus,
};

/** Input for creating a news folder (event materialization). */
export interface CreateNewsFolderInput {
  title: string;
  /** Defaults to `open`. */
  status?: NewsFolderStatus;
  /** Defaults to now. */
  lastActivityAt?: Date;
  closedAt?: Date | null;
}

/** Input for attaching an article to a folder (membership only). */
export interface AttachArticleToFolderInput {
  folderId: string;
  articleId: string;
  role: NewsFolderArticleRole;
  enrichmentType?: string | null;
  enrichmentFacts?: Prisma.InputJsonValue | null;
  attachedAt?: Date;
}

/** Input for appending a matching decision (never overwritten). */
export interface RecordMatchingDecisionInput {
  issue: MatchingDecisionIssue;
  articleId: string;
  folderId?: string | null;
  confidence: MatchingConfidence;
  motiveCodes?: readonly string[];
  favorableSignals?: readonly string[];
  unfavorableSignals?: readonly string[];
  enrichmentFacts?: Prisma.InputJsonValue | null;
  proposalOrigin?: string | null;
  reevaluable?: boolean;
  decidedAt?: Date;
}

/** Input for updating folder metadata (activity / status). */
export interface UpdateNewsFolderInput {
  folderId: string;
  title?: string;
  status?: NewsFolderStatus;
  lastActivityAt?: Date;
  closedAt?: Date | null;
}

/**
 * Raised when a destructive operation would break folder / decision integrity
 * (e.g. deleting a folder that still has articles or decisions).
 */
export class NewsFolderIntegrityError extends Error {
  readonly code = "NEWS_FOLDER_INTEGRITY";

  constructor(message: string) {
    super(message);
    this.name = "NewsFolderIntegrityError";
  }
}
