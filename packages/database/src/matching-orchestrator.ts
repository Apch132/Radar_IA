import type { Prisma, PrismaClient } from "@prisma/client";
import {
  createMatchingEngine,
  type MatchingEngine,
  type MatchingEngineOptions,
  type MatchingEvaluationResult,
} from "@radar-ia/shared";

import { createMatchingPersistenceService } from "./matching-persistence-service.js";
import type { MatchingPersistenceService } from "./matching-persistence-service.js";
import type { PersistMatchingDecisionInput } from "./matching-persistence-types.js";
import {
  MatchingOrchestrationError,
  type MatchingOrchestrationInput,
  type MatchingOrchestrationResult,
} from "./matching-orchestration-types.js";

export interface MatchingOrchestrator {
  /**
   * Evaluate with the deterministic engine, then persist the proposal.
   * The engine remains the sole decision-maker; persistence owns the transaction.
   */
  process(
    input: MatchingOrchestrationInput,
  ): Promise<MatchingOrchestrationResult>;
}

export interface MatchingOrchestratorOptions {
  /** Injected engine (defaults to `createMatchingEngine()`). */
  engine?: MatchingEngine;
  /** Forwarded to `createMatchingEngine` when no engine is injected. */
  engineOptions?: MatchingEngineOptions;
  /** Injected persistence service (defaults to factory over `prisma`). */
  persistence?: MatchingPersistenceService;
}

function toEnrichmentJson(
  facts: MatchingEvaluationResult["enrichmentFacts"],
): Prisma.InputJsonValue | null {
  if (facts === null || facts.length === 0) {
    return null;
  }
  return {
    facts: facts.map((fact) => ({ key: fact.key, value: fact.value })),
  };
}

/**
 * Map a rule-engine proposal to a caller-shaped persistence command.
 * Never chooses or overrides the issue.
 */
export function proposalToPersistInput(
  articleId: string,
  proposal: MatchingEvaluationResult,
  decidedAt?: Date,
): PersistMatchingDecisionInput {
  const trace = {
    articleId,
    confidence: proposal.confidence,
    motiveCodes: proposal.motiveCodes,
    favorableSignals: proposal.favorableSignals,
    unfavorableSignals: proposal.unfavorableSignals,
    enrichmentFacts: toEnrichmentJson(proposal.enrichmentFacts),
    proposalOrigin: proposal.proposalOrigin,
    reevaluable: proposal.reevaluable,
    decidedAt,
  };

  switch (proposal.issue) {
    case "create_dossier": {
      if (proposal.folderTitle === null || proposal.folderTitle.length === 0) {
        throw new MatchingOrchestrationError(
          "Cannot persist create_dossier: engine proposal lacks folderTitle",
        );
      }
      return {
        ...trace,
        issue: "create_dossier",
        folderTitle: proposal.folderTitle,
      };
    }
    case "attach_enrich": {
      if (proposal.folderId === null) {
        throw new MatchingOrchestrationError(
          "Cannot persist attach_enrich: engine proposal lacks folderId",
        );
      }
      return {
        ...trace,
        issue: "attach_enrich",
        folderId: proposal.folderId,
        enrichmentType: proposal.enrichmentType,
      };
    }
    case "duplicate_editorial": {
      if (proposal.folderId === null) {
        throw new MatchingOrchestrationError(
          "Cannot persist duplicate_editorial: engine proposal lacks folderId",
        );
      }
      return {
        ...trace,
        issue: "duplicate_editorial",
        folderId: proposal.folderId,
      };
    }
    case "ambiguous_no_action":
      return {
        ...trace,
        issue: "ambiguous_no_action",
        folderId: proposal.folderId,
      };
    default: {
      const _exhaustive: never = proposal.issue;
      throw new MatchingOrchestrationError(
        `Unsupported matching issue: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }
}

/**
 * Factory for the matching orchestrator (006.1E).
 * Minimal wiring: engine (rules) → persistence service (transaction) → repository.
 */
export function createMatchingOrchestrator(
  prisma: PrismaClient,
  options: MatchingOrchestratorOptions = {},
): MatchingOrchestrator {
  const engine =
    options.engine ?? createMatchingEngine(options.engineOptions ?? {});
  const persistence =
    options.persistence ?? createMatchingPersistenceService(prisma);

  return {
    async process(input) {
      const proposal = engine.evaluate(
        input.article,
        input.candidateFolders,
      );
      const persistInput = proposalToPersistInput(
        input.articleId,
        proposal,
        input.decidedAt,
      );
      const persistenceResult = await persistence.persistDecision(persistInput);

      return {
        proposal,
        persistence: persistenceResult,
      };
    },
  };
}
