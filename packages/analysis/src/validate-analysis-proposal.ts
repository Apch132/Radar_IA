import { z } from "zod";

import {
  ENTITY_MAX_LENGTH,
  ENTITIES_MAX_COUNT,
  FACT_KEY_MAX_LENGTH,
  FACT_VALUE_MAX_LENGTH,
  PROPOSED_FACTS_MAX_COUNT,
  RATIONALE_MAX_LENGTH,
  SECONDARY_CATEGORIES_MAX_COUNT,
  SUMMARY_MAX_LENGTH,
  SUMMARY_MIN_LENGTH,
} from "./analysis-constants.js";
import {
  ANALYSIS_CATEGORIES,
  ANNOUNCEMENT_NATURES,
  CHANNEL_ROLE_HINTS,
  FACT_SUPPORT_VALUES,
  PUBLISH_WORTHINESS_VALUES,
  type AnalysisClientErrorCode,
  type AnalysisProposalV1,
} from "./analysis-proposal-types.js";

/** Unicode code-point length (gel 007.1A §6). */
export function unicodeLength(value: string): number {
  return Array.from(value).length;
}

function isFiniteInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value);
}

/** confidence ∈ [0, 1] and multiple of 0.01 (no silent rounding). */
export function isConfidenceGrid(value: number): boolean {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return false;
  }
  const scaled = value * 100;
  return Math.abs(scaled - Math.round(scaled)) < 1e-9;
}

const scoreIntSchema = z
  .number()
  .refine(isFiniteInteger, { message: "must be a finite integer" })
  .refine((value) => value >= 0 && value <= 100, {
    message: "must be an integer between 0 and 100",
  });

const confidenceSchema = z
  .number()
  .refine(isConfidenceGrid, {
    message: "must be a finite multiple of 0.01 in [0, 1]",
  });

const trimmedNonEmptyFactString = (max: number) =>
  z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: "must be non-empty after trim" })
    .refine((value) => unicodeLength(value) <= max, {
      message: `must be at most ${max} Unicode code points`,
    });

const proposedFactSchema = z
  .object({
    key: trimmedNonEmptyFactString(FACT_KEY_MAX_LENGTH),
    value: trimmedNonEmptyFactString(FACT_VALUE_MAX_LENGTH),
    support: z.enum(FACT_SUPPORT_VALUES),
  })
  .strict();

const analysisProposalObjectSchema = z
  .object({
    schemaVersion: z.literal("1"),
    summary: z.string(),
    classification: z
      .object({
        primaryCategory: z.enum(ANALYSIS_CATEGORIES),
        secondaryCategories: z
          .array(z.enum(ANALYSIS_CATEGORIES))
          .max(SECONDARY_CATEGORIES_MAX_COUNT),
        announcementNature: z.enum(ANNOUNCEMENT_NATURES),
      })
      .strict(),
    scoring: z
      .object({
        relevance: scoreIntSchema,
        impact: scoreIntSchema,
        novelty: scoreIntSchema,
        confidence: confidenceSchema,
      })
      .strict(),
    entities: z
      .array(
        z.string().refine((value) => unicodeLength(value) <= ENTITY_MAX_LENGTH, {
          message: `each entity must be at most ${ENTITY_MAX_LENGTH} Unicode code points`,
        }),
      )
      .max(ENTITIES_MAX_COUNT),
    proposedFacts: z.array(proposedFactSchema).max(PROPOSED_FACTS_MAX_COUNT),
    editorialProposal: z
      .object({
        publishWorthiness: z.enum(PUBLISH_WORTHINESS_VALUES),
        suggestedChannelRole: z.enum(CHANNEL_ROLE_HINTS),
      })
      .strict(),
    rationale: z.string(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const summary = value.summary.trim();
    const summaryLen = unicodeLength(summary);
    if (summaryLen < SUMMARY_MIN_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary"],
        message: "empty_summary",
      });
    } else if (summaryLen > SUMMARY_MAX_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary"],
        message: "schema_violation",
      });
    }

    const rationale = value.rationale.trim();
    if (unicodeLength(rationale) > RATIONALE_MAX_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rationale"],
        message: "schema_violation",
      });
    }

    const { primaryCategory, secondaryCategories } = value.classification;
    const seen = new Set<string>();
    for (const [index, category] of secondaryCategories.entries()) {
      if (category === primaryCategory) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["classification", "secondaryCategories", index],
          message: "secondaryCategories must not duplicate primaryCategory",
        });
      }
      if (seen.has(category)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["classification", "secondaryCategories", index],
          message: "secondaryCategories must not contain duplicates",
        });
      }
      seen.add(category);
    }
  });

export type AnalysisProposalValidationSuccess = {
  ok: true;
  proposal: AnalysisProposalV1;
};

export type AnalysisProposalValidationFailure = {
  ok: false;
  errorCode: Extract<
    AnalysisClientErrorCode,
    "invalid_json" | "schema_violation" | "empty_summary"
  >;
  message: string;
};

export type AnalysisProposalValidationResult =
  | AnalysisProposalValidationSuccess
  | AnalysisProposalValidationFailure;

function mapZodError(
  error: z.ZodError,
): AnalysisProposalValidationFailure {
  for (const issue of error.issues) {
    if (issue.message === "empty_summary") {
      return {
        ok: false,
        errorCode: "empty_summary",
        message: "summary is empty or shorter than the V1 minimum after trim",
      };
    }
  }
  return {
    ok: false,
    errorCode: "schema_violation",
    message: error.issues[0]?.message ?? "AnalysisProposalV1 schema violation",
  };
}

/**
 * Parse a JSON string into a strictly validated `AnalysisProposalV1`.
 * No Markdown fence stripping (gel 007.1A §15).
 */
export function parseAnalysisProposalJson(
  raw: string,
): AnalysisProposalValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      ok: false,
      errorCode: "invalid_json",
      message: "response is not valid JSON",
    };
  }
  return validateAnalysisProposal(parsed);
}

/**
 * Strict validation of an already-parsed value against AnalysisProposalV1.
 * Trims `summary` / `rationale` / fact strings on success.
 */
export function validateAnalysisProposal(
  value: unknown,
): AnalysisProposalValidationResult {
  const result = analysisProposalObjectSchema.safeParse(value);
  if (!result.success) {
    return mapZodError(result.error);
  }

  const data = result.data;
  const proposal: AnalysisProposalV1 = {
    schemaVersion: "1",
    summary: data.summary.trim(),
    classification: {
      primaryCategory: data.classification.primaryCategory,
      secondaryCategories: [...data.classification.secondaryCategories],
      announcementNature: data.classification.announcementNature,
    },
    scoring: {
      relevance: data.scoring.relevance,
      impact: data.scoring.impact,
      novelty: data.scoring.novelty,
      confidence: data.scoring.confidence,
    },
    entities: [...data.entities],
    proposedFacts: data.proposedFacts.map((fact) => ({
      key: fact.key,
      value: fact.value,
      support: fact.support,
    })),
    editorialProposal: {
      publishWorthiness: data.editorialProposal.publishWorthiness,
      suggestedChannelRole: data.editorialProposal.suggestedChannelRole,
    },
    rationale: data.rationale.trim(),
  };

  return { ok: true, proposal };
}
