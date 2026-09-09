import { describe, expect, it } from "vitest";

import {
  decidePublication,
  mapChannelSalonHint,
} from "./analysis-decision.js";

describe("publication decisions", () => {
  const baseAccepted = {
    validationStatus: "accepted" as const,
    hasMainPublication: false,
    isMaterialEnrichReanalysis: false,
    anchoredFactCount: 0,
    priorHoldCount: 0,
  };

  it("37. publish when composite high and worthiness medium", () => {
    const { decision } = decidePublication({
      ...baseAccepted,
      composite: 75,
      publishWorthiness: "medium",
    });
    expect(decision).toBe("publish");
  });

  it("38. reject_editorial on low score", () => {
    const { decision } = decidePublication({
      ...baseAccepted,
      composite: 40,
      publishWorthiness: "medium",
    });
    expect(decision).toBe("reject_editorial");
  });

  it("39. hold in intermediate zone", () => {
    const { decision } = decidePublication({
      ...baseAccepted,
      composite: 60,
      publishWorthiness: "medium",
    });
    expect(decision).toBe("hold");
  });

  it("40. enrich_thread_only by score", () => {
    const { decision } = decidePublication({
      ...baseAccepted,
      hasMainPublication: true,
      isMaterialEnrichReanalysis: true,
      composite: 55,
      publishWorthiness: "low",
      anchoredFactCount: 0,
    });
    expect(decision).toBe("enrich_thread_only");
  });

  it("41. enrich_thread_only by anchored fact", () => {
    const { decision } = decidePublication({
      ...baseAccepted,
      hasMainPublication: true,
      isMaterialEnrichReanalysis: true,
      composite: 40,
      publishWorthiness: "low",
      anchoredFactCount: 1,
    });
    expect(decision).toBe("enrich_thread_only");
  });

  it("42. never second publish when already published", () => {
    const { decision } = decidePublication({
      ...baseAccepted,
      hasMainPublication: true,
      isMaterialEnrichReanalysis: false,
      composite: 90,
      publishWorthiness: "high",
    });
    expect(decision).not.toBe("publish");
  });

  it("43. worthiness high without score → not publish", () => {
    const { decision } = decidePublication({
      ...baseAccepted,
      composite: 50,
      publishWorthiness: "high",
    });
    expect(decision).not.toBe("publish");
    expect(decision).toBe("hold");
  });

  it("44. override score 90 with worthiness none → publish", () => {
    const { decision } = decidePublication({
      ...baseAccepted,
      composite: 90,
      publishWorthiness: "none",
    });
    expect(decision).toBe("publish");
  });

  it("45. anti-blocage: 2 prior holds → reject_editorial", () => {
    const { decision } = decidePublication({
      ...baseAccepted,
      composite: 60,
      publishWorthiness: "medium",
      priorHoldCount: 2,
    });
    expect(decision).toBe("reject_editorial");
  });

  it("maps channel salon independently of LLM hint for premium", () => {
    expect(
      mapChannelSalonHint({
        composite: 90,
        effectiveImpact: 85,
        primaryCategory: "other",
        suggestedChannelRole: "none",
      }),
    ).toBe("annonces_majeures");

    expect(
      mapChannelSalonHint({
        composite: 72,
        effectiveImpact: 50,
        primaryCategory: "other",
        suggestedChannelRole: "annonces_majeures",
      }),
    ).toBe("veille_pertinente");
  });
});
