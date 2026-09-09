import type {
  AdminOperationOutcome,
  PipelineLockRecord,
  PipelineRunRecord,
} from "./administration-types.js";
import type { PipelineCycleResult } from "./pipeline-orchestration-types.js";

/** Reason a folder/item appears on the intervention queue. */
export type AdminInterventionReason =
  | "publication_partial"
  | "publication_failed"
  | "publication_inconsistent"
  | "analysis_exhausted"
  | "ambiguous_no_action"
  | "folder_closed";

/** Single intervention item for Discord / CLI consultation. */
export interface AdminInterventionItem {
  readonly reason: AdminInterventionReason;
  readonly folderId: string | null;
  readonly articleId: string | null;
  readonly detail: string | null;
  readonly updatedAt: Date;
}

/** Three-layer pipeline status (gel 009.1A §12). */
export interface AdminPipelineStatus {
  readonly lock: PipelineLockRecord;
  readonly latestRun: PipelineRunRecord | null;
  readonly publication: {
    readonly needingResume: number;
    readonly inconsistent: number;
    readonly partial: number;
    readonly failed: number;
  };
  readonly analysis: {
    readonly exhaustedFolders: number;
  };
  readonly matching: {
    readonly ambiguousRecent: number;
  };
  readonly folders: {
    readonly closed: number;
  };
}

/** Source definition + runtime state for admin consultation. */
export interface AdminSourceStatusItem {
  readonly sourceId: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly tier: string;
  readonly lastSuccessfulAt: Date | null;
  readonly lastHttpStatus: number | null;
  readonly consecutiveFailures: number;
  readonly nextEligibleAt: Date | null;
  readonly inBackoff: boolean;
}

export interface AdminSourcesStatus {
  readonly registryPath: string;
  readonly definitionCount: number;
  readonly enabledCount: number;
  readonly sources: readonly AdminSourceStatusItem[];
}

/** Health dashboard snapshot for `/radar-admin health`. */
export interface AdminHealthDashboard {
  readonly generatedAt: Date;
  readonly sources: {
    readonly live: number;
    readonly broken: number;
    readonly disabled: number;
    readonly enabled: number;
    readonly inBackoff: number;
  };
  readonly articles: {
    readonly total: number;
  };
  readonly folders: {
    readonly total: number;
    readonly open: number;
    readonly closed: number;
  };
  readonly analyses: {
    readonly total: number;
    readonly exhaustedFolders: number;
  };
  readonly publications: {
    readonly total: number;
    readonly mainPublished: number;
    readonly needingResume: number;
    readonly failed: number;
    readonly partial: number;
    readonly inconsistent: number;
  };
  readonly errors: {
    readonly latestRunErrorCount: number;
    readonly latestRunErrorCodes: readonly string[];
  };
  readonly timing: {
    readonly averageCycleDurationMs: number | null;
    readonly lastCycleDurationMs: number | null;
  };
  readonly lastPublicationAt: Date | null;
  readonly lastSuccessfulCycleAt: Date | null;
}


export interface AdminOpsActorContext {
  readonly actorId: string;
}

export interface AdminRunCycleResult {
  readonly outcome: AdminOperationOutcome;
  readonly auditId: string;
  readonly cycle: PipelineCycleResult;
}

export interface AdminResumePublicationResult {
  readonly outcome: AdminOperationOutcome;
  readonly auditId: string;
  readonly folderId: string;
  readonly kind: string;
  readonly detail: string;
}

export interface AdminForceReanalysisResult {
  readonly outcome: AdminOperationOutcome;
  readonly auditId: string;
  readonly folderId: string;
  readonly status: string;
  readonly detail: string;
}

/** Minimal registry shape (file SoT) consumed by admin sources status. */
export interface AdminSourceRegistry {
  readonly sources: readonly {
    readonly id: string;
    readonly name: string;
    readonly tier: string;
    readonly enabled: boolean;
  }[];
}

export type AdminSourceRegistryLoader =
  | AdminSourceRegistry
  | (() => AdminSourceRegistry | Promise<AdminSourceRegistry>);
