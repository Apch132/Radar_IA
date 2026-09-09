export {
  OLLAMA_INFERENCE_TIMEOUT_MS,
  OLLAMA_QUEUE_TIMEOUT_MS,
  OLLAMA_MAX_ATTEMPTS,
  OLLAMA_MAX_CONCURRENCY,
  OLLAMA_MAX_RESPONSE_BYTES,
  OLLAMA_RETRY_DELAYS_MS,
  SUMMARY_MIN_LENGTH,
  SUMMARY_MAX_LENGTH,
  RATIONALE_MAX_LENGTH,
  ENTITIES_MAX_COUNT,
  ENTITY_MAX_LENGTH,
  PROPOSED_FACTS_MAX_COUNT,
  FACT_KEY_MAX_LENGTH,
  FACT_VALUE_MAX_LENGTH,
  SECONDARY_CATEGORIES_MAX_COUNT,
} from "./analysis-constants.js";

export { AnalysisClientError } from "./analysis-errors.js";

export {
  ANALYSIS_CATEGORIES,
  ANNOUNCEMENT_NATURES,
  CHANNEL_ROLE_HINTS,
  PUBLISH_WORTHINESS_VALUES,
  FACT_SUPPORT_VALUES,
  ANALYSIS_CLIENT_ERROR_CODES,
  RETRYABLE_CLIENT_ERROR_CODES,
  type AnalysisCategory,
  type AnnouncementNature,
  type ChannelRoleHint,
  type PublishWorthiness,
  type FactSupport,
  type ProposedFactV1,
  type AnalysisProposalV1,
  type AnalysisClientErrorCode,
} from "./analysis-proposal-types.js";

export {
  unicodeLength,
  isConfidenceGrid,
  parseAnalysisProposalJson,
  validateAnalysisProposal,
  type AnalysisProposalValidationResult,
  type AnalysisProposalValidationSuccess,
  type AnalysisProposalValidationFailure,
} from "./validate-analysis-proposal.js";

export {
  createOllamaAnalysisClient,
  type FetchLike,
  type SleepFn,
  type OllamaClientConfig,
  type CreateOllamaAnalysisClientOptions,
  type AnalysisInferenceInput,
  type AnalysisInferenceSuccess,
  type AnalysisInferenceFailure,
  type AnalysisInferenceResult,
  type OllamaAnalysisClient,
} from "./ollama-client.js";

export {
  canonicalizeAggregateFingerprint,
  computeAggregateFingerprint,
  type AggregateFingerprintInput,
} from "./aggregate-fingerprint.js";

export {
  CONTEXT_BODY_MAX_CHARS,
  CONTEXT_ARTICLE_MAX_CHARS,
  CONTEXT_FACTS_MAX_CHARS,
  buildAnalysisContext,
  type AnalysisContextInput,
  type BuiltAnalysisContext,
  type BuildAnalysisContextResult,
} from "./analysis-context-builder.js";

export {
  ANALYSIS_PROMPT_VERSION,
  ANALYSIS_SYSTEM_PROMPT,
  UNTRUSTED_CONTENT_START,
  UNTRUSTED_CONTENT_END,
  buildAnalysisUserPrompt,
  promptEncodesBackendDecisionThresholds,
} from "./analysis-prompt.js";

export {
  normalizeAnchorText,
  significantTokens,
  isFactAnchored,
  validateAndAnchorFacts,
  deduplicateEntities,
  type FactValidationResult,
  type EntityDedupResult,
} from "./analysis-fact-validation.js";

export {
  TIER_MULTIPLIERS,
  isSourceTier,
  isTierStrictlyHigher,
  resolveBestSourceTier,
  computeBackendScoring,
  type BackendScoringInput,
  type BackendScoringResult,
} from "./analysis-scoring.js";

export {
  decidePublication,
  mapChannelSalonHint,
  type PublicationDecisionInput,
  type PublicationDecisionResult,
  type ChannelMappingInput,
} from "./analysis-decision.js";

export {
  MATERIAL_ENRICHMENT_TYPES,
  isMaterialEnrichment,
  evaluateEligibility,
  type EligibilityOutcome,
  type MaterialEnrichmentType,
} from "./analysis-eligibility.js";

export {
  createAnalysisService,
  type AnalysisService,
} from "./analysis-service.js";

export {
  evaluateDeterministicFallback,
  isDeterministicFallbackSourceId,
  DETERMINISTIC_FALLBACK_SOURCE_IDS,
  type DecisionMethod,
  type DeterministicFallbackInput,
  type DeterministicFallbackResult,
  type DeterministicFallbackMatch,
  type DeterministicFallbackMiss,
  type DeterministicFallbackSourceId,
} from "./deterministic-fallback.js";

export {
  OFFICIAL_PUBLISHERS,
  OFFICIAL_WHITELIST_SOURCE_IDS,
  isOfficialWhitelistSource,
  resolveOfficialPublisher,
  type OfficialPublisher,
  type OfficialWhitelistSourceId,
} from "./official-whitelist.js";

export {
  evaluateImportance,
  isCriticalImportance,
  type ImportanceEvaluation,
  type ImportanceInput,
  type ImportanceLevel,
  type ImportanceSignal,
} from "./importance-evaluation.js";

export {
  buildAnalysisFailedEvent,
  buildAnalysisSucceededEvent,
  mapInferenceErrorToLogCode,
  type AnalysisFailedEvent,
  type AnalysisSucceededEvent,
} from "./analysis-events.js";

export type {
  SourceTier,
  AnalysisFolderStatus,
  MatchingTriggerIssue,
  AnalysisValidationStatus,
  AnalysisWarningCode,
  AnalysisErrorCode,
  PublicationDecision,
  BackendScoringV1,
  ValidatedAnalysisV1,
  EnrichmentFactInput,
  AnalysisArticleInput,
  AnalysisFolderInput,
  LastAcceptedAnalysisHint,
  AnalyzeFolderInput,
  ChannelSalonHint,
  AnalysisServiceResult,
  AnalysisAttemptPersistence,
  AnalysisServiceClock,
  AnalysisServiceLogger,
  AnalysisFailureDetail,
  CreateAnalysisServiceDependencies,
} from "./analysis-service-types.js";
