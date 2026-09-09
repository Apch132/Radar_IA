/**
 * Centralized numeric knobs for the deterministic matching engine.
 * Qualitative confidence levels remain normative (006.1A §5.6);
 * these values are implementation reserves (006.1A §16.3).
 */
export const MATCHING_THRESHOLDS = {
  /** Days around folder reference date that boost temporal proximity. */
  temporalProximityDays: 14,
  /** Minimum token length retained when normalizing entity labels. */
  minEntityTokenLength: 2,
  /** Minimum overlapping normalized entity tokens for "same entities". */
  minSharedEntities: 1,
  /** Title/summary length below which primary info is considered too thin. */
  minPrimaryTextLength: 12,
} as const;

export type MatchingThresholds = typeof MATCHING_THRESHOLDS;
