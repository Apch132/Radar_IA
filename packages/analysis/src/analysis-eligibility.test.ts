import { describe, expect, it } from "vitest";

import {
  evaluateEligibility,
  isMaterialEnrichment,
} from "./analysis-eligibility.js";
import type { AnalyzeFolderInput } from "./analysis-service-types.js";

function baseInput(
  overrides: Partial<AnalyzeFolderInput> &
    Pick<AnalyzeFolderInput, "triggerIssue">,
): AnalyzeFolderInput {
  return {
    folderId: "f1",
    folder: { id: "f1", status: "open", title: "Titre" },
    articles: [
      {
        articleId: "a1",
        role: "primary",
        sourceTier: "B",
        title: "T",
        url: "https://ex.com/a1",
        attachedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
    enrichmentFacts: [],
    hasMainPublication: false,
    ...overrides,
  };
}

describe("eligibility", () => {
  it("8. create_dossier is eligible", () => {
    const result = evaluateEligibility(
      baseInput({ triggerIssue: "create_dossier" }),
      "B",
    );
    expect(result.eligible).toBe(true);
  });

  it("9. duplicate_editorial skips", () => {
    const result = evaluateEligibility(
      baseInput({ triggerIssue: "duplicate_editorial" }),
      "B",
    );
    expect(result).toEqual({ eligible: false, reason: "not_eligible" });
  });

  it("10. ambiguous_no_action skips", () => {
    const result = evaluateEligibility(
      baseInput({ triggerIssue: "ambiguous_no_action" }),
      "B",
    );
    expect(result).toEqual({ eligible: false, reason: "not_eligible" });
  });

  it("11. closed folder skips", () => {
    const result = evaluateEligibility(
      baseInput({
        triggerIssue: "create_dossier",
        folder: { id: "f1", status: "closed", title: "X" },
      }),
      "B",
    );
    expect(result).toEqual({ eligible: false, reason: "not_eligible" });
  });

  it("13. immaterial enrichment skips", () => {
    const result = evaluateEligibility(
      baseInput({
        triggerIssue: "attach_enrich",
        triggerEnrichmentType: "confirmation",
        enrichmentFacts: [{ key: "same", value: "1" }],
        previousEnrichmentFactKeys: ["same"],
        lastAcceptedAnalysis: {
          attemptId: "att-1",
          aggregateFingerprint: "a".repeat(64),
          bestSourceTier: "B",
          publicationDecision: "publish",
          analyzedAt: "2026-07-01T00:00:00.000Z",
          validationStatus: "accepted",
        },
      }),
      "B",
    );
    expect(result).toEqual({
      eligible: false,
      reason: "enrichment_immaterial",
    });
  });

  it("14. material by enrichment type", () => {
    expect(
      isMaterialEnrichment({
        triggerEnrichmentType: "correction",
        enrichmentFacts: [],
        previousEnrichmentFactKeys: [],
        bestSourceTier: "B",
        lastAcceptedBestSourceTier: "B",
      }),
    ).toBe(true);
  });

  it("15. material by new fact key", () => {
    expect(
      isMaterialEnrichment({
        triggerEnrichmentType: "confirmation",
        enrichmentFacts: [{ key: "new_key", value: "x" }],
        previousEnrichmentFactKeys: ["old"],
        bestSourceTier: "B",
        lastAcceptedBestSourceTier: "B",
      }),
    ).toBe(true);
  });

  it("16. material by better tier", () => {
    expect(
      isMaterialEnrichment({
        triggerEnrichmentType: "confirmation",
        enrichmentFacts: [],
        previousEnrichmentFactKeys: [],
        bestSourceTier: "S",
        lastAcceptedBestSourceTier: "B",
      }),
    ).toBe(true);
  });
});
