export { createPrismaClient } from "./client.js";
export type { CreatePrismaClientOptions } from "./client.js";

export { createRawFeedRepository } from "./raw-feed-repository.js";
export type { RawFeedRepository } from "./raw-feed-repository.js";

export type {
  CollectedSourceState,
  RawFeedSnapshot,
  RecordSourceBackoffInput,
  SaveCollectedSourceStateInput,
  SaveRawFeedSnapshotInput,
} from "./raw-feed-types.js";

export { createNormalizedArticleRepository } from "./normalized-article-repository.js";
export type { NormalizedArticleRepository } from "./normalized-article-repository.js";

export {
  buildEditorialSnapshot,
  canonicalizeEditorialUrl,
  computeEditorialHash,
  editorialSnapshotFromSaveInput,
  isEditorialUnchanged,
  listEditorialChangedFields,
  normalizeEditorialText,
} from "./editorial-content.js";
export type {
  EditorialFieldName,
  EditorialSnapshot,
} from "./editorial-content.js";

export type {
  NormalizedArticle,
  PersistNormalizedArticleOutcome,
  PersistNormalizedArticleResult,
  PersistNormalizedArticlesResult,
  SaveNormalizedArticleInput,
} from "./normalized-article-types.js";

export { createNewsFolderRepository } from "./news-folder-repository.js";
export type { NewsFolderRepository } from "./news-folder-repository.js";

export {
  NewsFolderIntegrityError,
} from "./news-folder-types.js";
export type {
  AttachArticleToFolderInput,
  CreateNewsFolderInput,
  MatchingConfidence,
  MatchingDecision,
  MatchingDecisionIssue,
  NewsFolder,
  NewsFolderArticle,
  NewsFolderArticleRole,
  NewsFolderStatus,
  RecordMatchingDecisionInput,
  UpdateNewsFolderInput,
} from "./news-folder-types.js";

export { createMatchingPersistenceService } from "./matching-persistence-service.js";
export type { MatchingPersistenceService } from "./matching-persistence-service.js";

export { MatchingPersistenceError } from "./matching-persistence-types.js";
export type {
  MatchingDecisionTraceInput,
  PersistAmbiguousNoActionInput,
  PersistAttachEnrichInput,
  PersistCreateDossierInput,
  PersistDuplicateEditorialInput,
  PersistMatchingDecisionInput,
  PersistMatchingDecisionResult,
} from "./matching-persistence-types.js";

export {
  createMatchingOrchestrator,
  proposalToPersistInput,
} from "./matching-orchestrator.js";
export type {
  MatchingOrchestrator,
  MatchingOrchestratorOptions,
} from "./matching-orchestrator.js";

export { MatchingOrchestrationError } from "./matching-orchestration-types.js";
export type {
  MatchingOrchestrationInput,
  MatchingOrchestrationResult,
} from "./matching-orchestration-types.js";

export { createAnalysisAttemptRepository } from "./analysis-attempt-repository.js";
export type { AnalysisAttemptRepository } from "./analysis-attempt-repository.js";

export {
  AnalysisIntegrityError,
  ANALYSIS_ERROR_CODES,
  ANALYSIS_WARNING_CODES,
  SHA256_HEX_PATTERN,
} from "./analysis-types.js";
export type {
  AnalysisAttemptRecord,
  AnalysisCategory,
  AnalysisErrorCode,
  AnalysisProposalV1,
  AnalysisValidationStatus,
  AnalysisWarningCode,
  AnnouncementNature,
  BackendScoringV1,
  ChannelRoleHint,
  FactSupport,
  ListAnalysisAttemptsOptions,
  ProposedFactV1,
  PublicationDecision,
  PublishWorthiness,
  RecordAnalysisAttemptInput,
  SourceTier,
  ValidatedAnalysisV1,
} from "./analysis-types.js";

export {
  createAnalysisOrchestrator,
} from "./analysis-orchestrator.js";
export type {
  AnalysisOrchestrator,
  AnalysisOrchestratorOptions,
} from "./analysis-orchestrator.js";

export {
  AnalysisOrchestrationError,
  matchingResultToAnalysisInput,
} from "./analysis-orchestration-types.js";
export type {
  AnalysisOrchestrationErrorCode,
  AnalysisOrchestrationInput,
  AnalysisOrchestrationResult,
  AnalysisOrchestrationSkipCode,
  AnalysisOrchestrationStatus,
} from "./analysis-orchestration-types.js";

export { createPublicationRepository } from "./publication-repository.js";
export type { PublicationRepository } from "./publication-repository.js";

export {
  PublicationPersistenceError,
  PUBLICATION_ERROR_CODES,
  PUBLICATION_STATUSES,
  PUBLICATION_STATUS_TRANSITIONS,
  buildCreateThreadIdempotencyKey,
  buildEnrichIdempotencyKey,
  buildPublishIdempotencyKey,
  buildUnarchiveIdempotencyKey,
  computeHasMainPublication,
} from "./publication-types.js";
export type {
  FolderPublicationRecord,
  GetOrCreateFolderPublicationInput,
  ListPublicationAttemptsOptions,
  ListRetryablePublicationOptions,
  PublicationAttemptRecord,
  PublicationAttemptStatus,
  PublicationErrorCode,
  PublicationOperationKind,
  PublicationPersistenceErrorCode,
  PublicationStatus,
  RecordEnrichmentPublishedInput,
  RecordMainPublicationSuccessInput,
  RecordPublicationFailureInput,
  RecordThreadCreatedInput,
  ReservePublicationOperationInput,
  ReservePublicationOutcome,
  ReservePublishInput,
} from "./publication-types.js";

export { createPublicationOrchestrator } from "./publication-orchestrator.js";
export type {
  PublicationContentBuilders,
  PublicationOrchestrator,
  PublicationOrchestratorOptions,
} from "./publication-orchestrator.js";

export {
  DiscordPublicationPortError,
  PUBLICATION_THREAD_AUTO_ARCHIVE_MINUTES,
  PublicationOrchestrationError,
} from "./publication-orchestration-types.js";
export type {
  DiscordPublicationPort,
  DiscordPublicationPortErrorCode,
  PublicationChannelResolver,
  PublicationOrchestrationChannelHint,
  PublicationOrchestrationDecision,
  PublicationOrchestrationInput,
  PublicationOrchestrationResult,
  PublicationOrchestrationSkipReason,
  PublicationOrchestrationValidatedContent,
} from "./publication-orchestration-types.js";

export {
  createAdminOperationLogRepository,
  createPipelineLockRepository,
} from "./administration-repository.js";
export {
  createInferenceLockRepository,
  INFERENCE_LOCK_ID,
  type AcquireInferenceLockInput,
  type AcquireInferenceLockOutcome,
  type InferenceLockRecord,
  type InferenceLockRepository,
} from "./inference-lock-repository.js";
export type {
  AdminOperationLogRepository,
  PipelineLockRepository,
} from "./administration-repository.js";

export {
  AdministrationPersistenceError,
  ADMIN_OPERATION_KINDS,
  ADMIN_OPERATION_OUTCOMES,
  PIPELINE_LOCK_ID,
  PIPELINE_RUN_STATUSES,
  PIPELINE_RUN_TRIGGERS,
} from "./administration-types.js";
export type {
  AcquirePipelineLockInput,
  AcquirePipelineLockOutcome,
  AdministrationPersistenceErrorCode,
  AdminOperationKind,
  AdminOperationLogRecord,
  AdminOperationOutcome,
  HeartbeatPipelineLockInput,
  ListAdminOperationsOptions,
  ListPipelineRunsOptions,
  PipelineLockRecord,
  PipelineRunRecord,
  PipelineRunStatus,
  PipelineRunTrigger,
  RecordAdminOperationInput,
  ReleasePipelineLockInput,
} from "./administration-types.js";

export {
  createPipelineOrchestrator,
  loadMatchingCandidateFolders,
} from "./pipeline-orchestrator.js";
export type {
  PipelineOrchestrator,
  PipelineOrchestratorOptions,
} from "./pipeline-orchestrator.js";

export {
  createAdminOpsService,
} from "./admin-ops-service.js";
export type {
  AdminOpsService,
  AdminOpsServiceOptions,
} from "./admin-ops-service.js";
export type {
  AdminForceReanalysisResult,
  AdminHealthDashboard,
  AdminInterventionItem,
  AdminInterventionReason,
  AdminOpsActorContext,
  AdminPipelineStatus,
  AdminResumePublicationResult,
  AdminRunCycleResult,
  AdminSourceRegistry,
  AdminSourceRegistryLoader,
  AdminSourceStatusItem,
  AdminSourcesStatus,
} from "./admin-ops-types.js";

export {
  PipelineOrchestrationError,
  SOURCE_BACKOFF_DELAYS_MS,
  DEFAULT_PIPELINE_LOCK_TTL_MS,
  DEFAULT_PIPELINE_HEARTBEAT_INTERVAL_MS,
  computeSourceBackoffDelayMs,
  computeNextEligibleAt,
  sanitizePipelineMessage,
} from "./pipeline-orchestration-types.js";
export type {
  PipelineAnalysisCounters,
  PipelineArticleCounters,
  PipelineArticleNormalizer,
  PipelineClock,
  PipelineCollectResult,
  PipelineCycleInput,
  PipelineCycleRejectionCode,
  PipelineCycleResult,
  PipelineCycleSummary,
  PipelineIncrementalCollector,
  PipelineLogger,
  PipelineMatchingCounters,
  PipelineMatchingPort,
  PipelineNormalizedError,
  PipelineNormalizedErrorCode,
  PipelinePublicationCounters,
  PipelinePublicationPort,
  PipelineSourceCounters,
  PipelineSourceDefinition,
  PipelineSourceFetchState,
  PipelineSourceOutcome,
  PipelineSourceRegistry,
  PipelineSourceRegistryLoader,
} from "./pipeline-orchestration-types.js";
