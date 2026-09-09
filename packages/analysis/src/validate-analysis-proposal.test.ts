import { describe, expect, it } from "vitest";

import type { AnalysisProposalV1 } from "./analysis-proposal-types.js";
import {
  parseAnalysisProposalJson,
  validateAnalysisProposal,
} from "./validate-analysis-proposal.js";

/** Valid summary ≥ 40 Unicode code points. */
const VALID_SUMMARY =
  "OpenAI annonce une nouvelle version de son modèle phare avec des gains mesurables.";

function validProposal(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: "1",
    summary: VALID_SUMMARY,
    classification: {
      primaryCategory: "model_release",
      secondaryCategories: ["product_update"],
      announcementNature: "launch",
    },
    scoring: {
      relevance: 80,
      impact: 75,
      novelty: 70,
      confidence: 0.75,
    },
    entities: ["OpenAI"],
    proposedFacts: [
      { key: "vendor", value: "OpenAI", support: "explicit" },
    ],
    editorialProposal: {
      publishWorthiness: "high",
      suggestedChannelRole: "annonces_majeures",
    },
    rationale: "Annonce majeure de modèle.",
    ...overrides,
  };
}

describe("validateAnalysisProposal", () => {
  it("accepts a valid proposal", () => {
    const result = validateAnalysisProposal(validProposal());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.schemaVersion).toBe("1");
    expect(result.proposal.summary).toBe(VALID_SUMMARY);
    expect(result.proposal.scoring.confidence).toBe(0.75);
  });

  it("trims summary and rationale on success", () => {
    const result = validateAnalysisProposal(
      validProposal({
        summary: `  ${VALID_SUMMARY}  `,
        rationale: "  Justification courte.  ",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proposal.summary).toBe(VALID_SUMMARY);
    expect(result.proposal.rationale).toBe("Justification courte.");
  });

  it("rejects invalid JSON string", () => {
    const result = parseAnalysisProposalJson("{not json");
    expect(result).toEqual({
      ok: false,
      errorCode: "invalid_json",
      message: "response is not valid JSON",
    });
  });

  it("rejects Markdown-wrapped JSON as invalid_json", () => {
    const wrapped = `\`\`\`json\n${JSON.stringify(validProposal())}\n\`\`\``;
    const result = parseAnalysisProposalJson(wrapped);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("invalid_json");
  });

  it("rejects unknown root properties", () => {
    const result = validateAnalysisProposal(
      validProposal({ extraField: true }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("schema_violation");
  });

  it("rejects unknown schemaVersion", () => {
    const result = validateAnalysisProposal(
      validProposal({ schemaVersion: "2" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("schema_violation");
  });

  it("rejects invalid enums", () => {
    const result = validateAnalysisProposal(
      validProposal({
        classification: {
          primaryCategory: "not_a_category",
          secondaryCategories: [],
          announcementNature: "launch",
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("schema_violation");
  });

  it("rejects invalid ChannelRoleHint", () => {
    const result = validateAnalysisProposal(
      validProposal({
        editorialProposal: {
          publishWorthiness: "high",
          suggestedChannelRole: "annonces-majeures",
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("schema_violation");
  });

  it("rejects non-integer relevance", () => {
    const result = validateAnalysisProposal(
      validProposal({
        scoring: {
          relevance: 80.5,
          impact: 75,
          novelty: 70,
          confidence: 0.75,
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("schema_violation");
  });

  it("rejects confidence not on 0.01 grid", () => {
    const result = validateAnalysisProposal(
      validProposal({
        scoring: {
          relevance: 80,
          impact: 75,
          novelty: 70,
          confidence: 0.999,
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("schema_violation");
  });

  it("rejects secondaryCategories duplicating primary", () => {
    const result = validateAnalysisProposal(
      validProposal({
        classification: {
          primaryCategory: "research",
          secondaryCategories: ["research"],
          announcementNature: "paper",
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("schema_violation");
  });

  it("rejects summary shorter than 40 code points as empty_summary", () => {
    const result = validateAnalysisProposal(
      validProposal({ summary: "Trop court pour être utile." }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("empty_summary");
  });

  it("rejects empty summary as empty_summary", () => {
    const result = validateAnalysisProposal(validProposal({ summary: "   " }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("empty_summary");
  });

  it("rejects summary longer than 500 as schema_violation", () => {
    const result = validateAnalysisProposal(
      validProposal({ summary: "a".repeat(501) }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("schema_violation");
  });

  it("rejects rationale longer than 280 as schema_violation", () => {
    const result = validateAnalysisProposal(
      validProposal({ rationale: "r".repeat(281) }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("schema_violation");
  });

  it("rejects too many entities", () => {
    const result = validateAnalysisProposal(
      validProposal({
        entities: Array.from({ length: 13 }, (_, i) => `e${i}`),
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("schema_violation");
  });

  it("parses a valid JSON string into AnalysisProposalV1", () => {
    const json = JSON.stringify(validProposal());
    const result = parseAnalysisProposalJson(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const proposal: AnalysisProposalV1 = result.proposal;
    expect(proposal.editorialProposal.publishWorthiness).toBe("high");
  });
});
