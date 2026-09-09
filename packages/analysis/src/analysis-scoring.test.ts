import { describe, expect, it } from "vitest";

import {
  computeBackendScoring,
  resolveBestSourceTier,
  TIER_MULTIPLIERS,
} from "./analysis-scoring.js";

describe("backend scoring", () => {
  it("32. applies tier S multiplier", () => {
    const result = computeBackendScoring({
      relevance: 100,
      impact: 100,
      novelty: 100,
      confidence: 0.99,
      bestSourceTier: "S",
    });
    expect(result.tierMultiplier).toBe(TIER_MULTIPLIERS.S);
    expect(result.effectiveRelevance).toBe(100); // floor(110) clamped
    expect(result.effectiveImpact).toBe(100);
  });

  it("33. applies tier E multiplier", () => {
    const result = computeBackendScoring({
      relevance: 80,
      impact: 80,
      novelty: 50,
      bestSourceTier: "E",
    });
    expect(result.tierMultiplier).toBe(0.85);
    expect(result.effectiveRelevance).toBe(68); // floor(68)
    expect(result.effectiveImpact).toBe(68);
  });

  it("34. clamps to 0..100", () => {
    const result = computeBackendScoring({
      relevance: 200,
      impact: -10,
      novelty: 50,
      bestSourceTier: "S",
    });
    expect(result.effectiveRelevance).toBe(100);
    expect(result.effectiveImpact).toBe(0);
    expect(result.composite).toBeGreaterThanOrEqual(0);
    expect(result.composite).toBeLessThanOrEqual(100);
  });

  it("35. rounds composite", () => {
    // effRel=10, effImp=10, novelty=1 → 0.4*10+0.4*10+0.2*1 = 8.2 → 8
    const result = computeBackendScoring({
      relevance: 10,
      impact: 10,
      novelty: 1,
      bestSourceTier: "B",
    });
    expect(result.composite).toBe(8);
  });

  it("36. ignores confidence", () => {
    const low = computeBackendScoring({
      relevance: 70,
      impact: 70,
      novelty: 70,
      confidence: 0.01,
      bestSourceTier: "B",
    });
    const high = computeBackendScoring({
      relevance: 70,
      impact: 70,
      novelty: 70,
      confidence: 1,
      bestSourceTier: "B",
    });
    expect(low.composite).toBe(high.composite);
  });

  it("resolves best tier among mixed", () => {
    expect(resolveBestSourceTier(["E", "S", "B"])).toBe("S");
    expect(resolveBestSourceTier([])).toBe("E");
  });
});
