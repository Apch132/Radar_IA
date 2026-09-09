import type { PrismaClient } from "@prisma/client";

import { createNewsFolderRepository } from "./news-folder-repository.js";
import type { NewsFolderRepository } from "./news-folder-repository.js";
import type {
  PersistAttachEnrichInput,
  PersistCreateDossierInput,
  PersistDuplicateEditorialInput,
  PersistMatchingDecisionInput,
  PersistMatchingDecisionResult,
} from "./matching-persistence-types.js";
import { MatchingPersistenceError } from "./matching-persistence-types.js";
import type { RecordMatchingDecisionInput } from "./news-folder-types.js";

export interface MatchingPersistenceService {
  /**
   * Persist one caller-chosen matching outcome in a single transaction.
   * No similarity search and no automatic issue selection.
   */
  persistDecision(
    input: PersistMatchingDecisionInput,
  ): Promise<PersistMatchingDecisionResult>;
}

type TransactionClient = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

function toDecisionInput(
  input: PersistMatchingDecisionInput,
  folderId: string | null,
): RecordMatchingDecisionInput {
  return {
    issue: input.issue,
    articleId: input.articleId,
    folderId,
    confidence: input.confidence,
    motiveCodes: input.motiveCodes,
    favorableSignals: input.favorableSignals,
    unfavorableSignals: input.unfavorableSignals,
    enrichmentFacts: input.enrichmentFacts,
    proposalOrigin: input.proposalOrigin,
    reevaluable: input.reevaluable,
    decidedAt: input.decidedAt,
  };
}

async function persistCreateDossier(
  repo: NewsFolderRepository,
  input: PersistCreateDossierInput,
): Promise<PersistMatchingDecisionResult> {
  const activityAt = input.decidedAt ?? new Date();
  const folder = await repo.createFolder({
    title: input.folderTitle,
    status: "open",
    lastActivityAt: activityAt,
  });
  const membership = await repo.attachArticle({
    folderId: folder.id,
    articleId: input.articleId,
    role: "primary",
    attachedAt: activityAt,
  });
  const decision = await repo.recordDecision(
    toDecisionInput(input, folder.id),
  );

  return { decision, folder, membership };
}

async function persistAttachEnrich(
  repo: NewsFolderRepository,
  input: PersistAttachEnrichInput,
): Promise<PersistMatchingDecisionResult> {
  const folder = await repo.getFolder(input.folderId);
  if (folder === null) {
    throw new MatchingPersistenceError(
      `Cannot attach_enrich: news folder ${input.folderId} not found`,
    );
  }
  if (folder.status === "closed") {
    throw new MatchingPersistenceError(
      `Cannot attach_enrich: news folder ${input.folderId} is closed`,
    );
  }

  const activityAt = input.decidedAt ?? new Date();
  const membership = await repo.attachArticle({
    folderId: folder.id,
    articleId: input.articleId,
    role: "enrichment",
    enrichmentType: input.enrichmentType ?? null,
    enrichmentFacts: input.enrichmentFacts ?? null,
    attachedAt: activityAt,
  });

  const nextStatus = folder.status === "idle" ? "open" : folder.status;
  const updatedFolder = await repo.updateFolder({
    folderId: folder.id,
    status: nextStatus,
    lastActivityAt: activityAt,
  });

  const decision = await repo.recordDecision(
    toDecisionInput(input, folder.id),
  );

  return { decision, folder: updatedFolder, membership };
}

async function persistDuplicateEditorial(
  repo: NewsFolderRepository,
  input: PersistDuplicateEditorialInput,
): Promise<PersistMatchingDecisionResult> {
  const folder = await repo.getFolder(input.folderId);
  if (folder === null) {
    throw new MatchingPersistenceError(
      `Cannot duplicate_editorial: news folder ${input.folderId} not found`,
    );
  }

  const decision = await repo.recordDecision(
    toDecisionInput(input, folder.id),
  );

  return { decision, folder, membership: null };
}

async function persistAmbiguousNoAction(
  repo: NewsFolderRepository,
  input: Extract<PersistMatchingDecisionInput, { issue: "ambiguous_no_action" }>,
): Promise<PersistMatchingDecisionResult> {
  const folderId = input.folderId ?? null;
  let folder = null;

  if (folderId !== null) {
    folder = await repo.getFolder(folderId);
    if (folder === null) {
      throw new MatchingPersistenceError(
        `Cannot ambiguous_no_action: news folder ${folderId} not found`,
      );
    }
  }

  const decision = await repo.recordDecision(toDecisionInput(input, folderId));

  return { decision, folder, membership: null };
}

async function runPersist(
  repo: NewsFolderRepository,
  input: PersistMatchingDecisionInput,
): Promise<PersistMatchingDecisionResult> {
  switch (input.issue) {
    case "create_dossier":
      return persistCreateDossier(repo, input);
    case "attach_enrich":
      return persistAttachEnrich(repo, input);
    case "duplicate_editorial":
      return persistDuplicateEditorial(repo, input);
    case "ambiguous_no_action":
      return persistAmbiguousNoAction(repo, input);
    default: {
      const _exhaustive: never = input;
      throw new MatchingPersistenceError(
        `Unsupported matching issue: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

/**
 * Factory for the matching persistence service (006.1C).
 * Encapsulates transactional folder / membership / decision writes.
 * Prisma client is injected for testability; issue is always caller-chosen.
 */
export function createMatchingPersistenceService(
  prisma: PrismaClient,
): MatchingPersistenceService {
  return {
    async persistDecision(input) {
      return prisma.$transaction(async (tx: TransactionClient) => {
        const repo = createNewsFolderRepository(tx as unknown as PrismaClient);
        return runPersist(repo, input);
      });
    },
  };
}
