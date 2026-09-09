import { describe, expect, it } from "vitest";

import {
  ANALYSIS_SYSTEM_PROMPT,
  buildAnalysisUserPrompt,
  promptEncodesBackendDecisionThresholds,
} from "./analysis-prompt.js";

describe("analysis prompt", () => {
  it("22. asks for strict JSON V1", () => {
    const user = buildAnalysisUserPrompt({ contextBody: "folderId=f1" });
    expect(ANALYSIS_SYSTEM_PROMPT).toMatch(/JSON/i);
    expect(ANALYSIS_SYSTEM_PROMPT).toMatch(/schemaVersion/);
    expect(user).toMatch(/AnalysisProposalV1/);
    expect(`${ANALYSIS_SYSTEM_PROMPT}\n${user}`).toMatch(/schemaVersion/);
  });

  it("23. requests French responses", () => {
    expect(ANALYSIS_SYSTEM_PROMPT.toLowerCase()).toContain("français");
  });

  it("24. does not present backend thresholds as LLM verdict", () => {
    const user = buildAnalysisUserPrompt({ contextBody: "contexte" });
    const combined = `${ANALYSIS_SYSTEM_PROMPT}\n${user}`;
    expect(promptEncodesBackendDecisionThresholds(combined)).toBe(false);
    expect(combined.toLowerCase()).toMatch(/ne d[eé]cides? jamais/);
    expect(combined).not.toMatch(/composite\s*>=\s*70/i);
  });
});
