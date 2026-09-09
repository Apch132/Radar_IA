export { createMatchingEngine } from "./matching-engine.js";
export {
  MATCHING_THRESHOLDS,
  type MatchingThresholds,
} from "./matching-thresholds.js";
export {
  canonicalizeMatchingUrl,
  compareFingerprints,
  enrichmentTypeFor,
  extractArticleFacts,
  extractEventFingerprint,
  hasPrimaryInformation,
  isTierStrictlyHigher,
  normalizeToken,
  suggestFolderTitle,
} from "./matching-signals.js";
export type {
  AnnouncementNature,
  EventFingerprint,
  MatchingArticleInput,
  MatchingCandidateFolder,
  MatchingConfidence,
  MatchingDecisionIssue,
  MatchingEngine,
  MatchingEngineOptions,
  MatchingEnrichmentFact,
  MatchingEvaluationResult,
  MatchingFolderStatus,
  MatchingSourceTier,
} from "./matching-types.js";

export {
  DISCORD_LIMITS,
  TRUNCATION_ELLIPSIS,
  type DiscordLimitKey,
} from "./publication-discord-limits.js";

export {
  PUBLICATION_CHANNEL_ROLES,
  CHANNEL_HINT_TO_ROLE,
  ROLE_TO_CHANNEL_HINT,
  PublicationContentError,
  type PublicationChannelRole,
  type PublicationChannelHint,
  type PublicationValidatedContent,
  type PublicationSourceInput,
  type PublicationEnrichmentFactInput,
  type BuildMainPublicationContentInput,
  type BuildEnrichmentPublicationContentInput,
  type DiscordEmbedFieldPayload,
  type DiscordEmbedPayload,
  type RenderedDiscordPayload,
  type PublicationRenderWarningCode,
  type PublicationRenderWarning,
  type TruncationResult,
  type BuildMainPublicationContentResult,
  type BuildEnrichmentPublicationContentResult,
} from "./publication-discord-types.js";

export {
  unicodeLength,
  normalizeWhitespace,
  stripControlCharacters,
  stripHtml,
  neutralizeMentions,
  sanitizeDiscordText,
  acceptHttpUrl,
} from "./publication-discord-sanitize.js";

export {
  truncateDiscordText,
  truncateMessageContent,
  truncateEmbedTitle,
  truncateEmbedDescription,
  truncateEmbedFieldName,
  truncateEmbedFieldValue,
  truncateEmbedFooter,
  truncateThreadName,
  embedCharacterCount,
} from "./publication-discord-truncate.js";

export {
  formatUsefulDateUtc,
  preparePublicationSources,
  buildThreadName,
  buildMainPublicationContent,
  buildEnrichmentPublicationContent,
} from "./publication-discord-content.js";
