import type { Prisma } from "@prisma/client";

import type {
  MatchingConfidence,
  MatchingDecision,
  NewsFolder,
  NewsFolderArticle,
} from "./news-folder-types.js";

/** Shared decision metadata supplied by the caller (issue chosen upstream). */
export interface MatchingDecisionTraceInput {
  articleId: string;
  confidence: MatchingConfidence;
  motiveCodes?: readonly string[];
  favorableSignals?: readonly string[];
  unfavorableSignals?: readonly string[];
  enrichmentFacts?: Prisma.InputJsonValue | null;
  proposalOrigin?: string | null;
  reevaluable?: boolean;
  decidedAt?: Date;
}

/** Persist a new folder + primary membership + decision. */
export interface PersistCreateDossierInput extends MatchingDecisionTraceInput {
  issue: "create_dossier";
  folderTitle: string;
}

/** Persist enrichment membership + activity/status + decision. */
export interface PersistAttachEnrichInput extends MatchingDecisionTraceInput {
  issue: "attach_enrich";
  folderId: string;
  enrichmentType?: string | null;
}

/** Persist a duplicate decision without extra membership. */
export interface PersistDuplicateEditorialInput
  extends MatchingDecisionTraceInput {
  issue: "duplicate_editorial";
  folderId: string;
}

/** Persist ambiguity without folder creation or membership. */
export interface PersistAmbiguousNoActionInput
  extends MatchingDecisionTraceInput {
  issue: "ambiguous_no_action";
  folderId?: string | null;
}

/**
 * Caller-supplied issue + payload. The service never chooses the issue.
 */
export type PersistMatchingDecisionInput =
  | PersistCreateDossierInput
  | PersistAttachEnrichInput
  | PersistDuplicateEditorialInput
  | PersistAmbiguousNoActionInput;

/** Result of a transactional persistence of one matching decision. */
export interface PersistMatchingDecisionResult {
  decision: MatchingDecision;
  folder: NewsFolder | null;
  membership: NewsFolderArticle | null;
}

/**
 * Raised when a persistence command violates structural business rules
 * (missing folder, closed folder attach, etc.).
 */
export class MatchingPersistenceError extends Error {
  readonly code = "MATCHING_PERSISTENCE";

  constructor(message: string) {
    super(message);
    this.name = "MatchingPersistenceError";
  }
}
