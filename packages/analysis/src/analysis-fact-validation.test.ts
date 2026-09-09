import { describe, expect, it } from "vitest";

import {
  deduplicateEntities,
  isFactAnchored,
  validateAndAnchorFacts,
} from "./analysis-fact-validation.js";

describe("fact anchoring and entities", () => {
  const aggregate =
    "OpenAI releases GPT-5 with improved reasoning. Available in API on July 1.";
  const title = "OpenAI GPT-5 launch";

  it("25. keeps anchored explicit fact", () => {
    const result = validateAndAnchorFacts({
      proposedFacts: [
        { key: "model", value: "GPT-5", support: "explicit" },
      ],
      aggregateText: aggregate,
      folderTitle: title,
    });
    expect(result.retainedFacts).toHaveLength(1);
    expect(result.droppedFacts).toHaveLength(0);
  });

  it("26. drops inferred facts", () => {
    const result = validateAndAnchorFacts({
      proposedFacts: [
        { key: "model", value: "GPT-5", support: "inferred" },
      ],
      aggregateText: aggregate,
      folderTitle: title,
    });
    expect(result.retainedFacts).toHaveLength(0);
    expect(result.droppedFacts).toHaveLength(1);
  });

  it("27. drops unanchored explicit facts", () => {
    const result = validateAndAnchorFacts({
      proposedFacts: [
        { key: "price", value: "999 dollars secret", support: "explicit" },
      ],
      aggregateText: aggregate,
      folderTitle: title,
    });
    expect(result.retainedFacts).toHaveLength(0);
    expect(result.droppedFacts).toHaveLength(1);
  });

  it("28. keeps first duplicate key", () => {
    const result = validateAndAnchorFacts({
      proposedFacts: [
        { key: "Model", value: "GPT-5", support: "explicit" },
        { key: "model", value: "GPT-4", support: "explicit" },
      ],
      aggregateText: aggregate,
      folderTitle: title,
    });
    expect(result.retainedFacts).toHaveLength(1);
    expect(result.retainedFacts[0]!.value).toBe("GPT-5");
    expect(result.droppedFacts).toHaveLength(1);
  });

  it("29. warns facts_dropped", () => {
    const result = validateAndAnchorFacts({
      proposedFacts: [
        { key: "x", value: "not-in-text-zzz", support: "explicit" },
      ],
      aggregateText: aggregate,
      folderTitle: title,
    });
    expect(result.warnings).toContain("facts_dropped");
  });

  it("30-31. deduplicates entities case-insensitively with warning", () => {
    const result = deduplicateEntities(["OpenAI", "openai", "Anthropic"]);
    expect(result.entities).toEqual(["OpenAI", "Anthropic"]);
    expect(result.warnings).toContain("entities_deduplicated");
  });

  it("anchors via significant tokens", () => {
    expect(
      isFactAnchored(
        { key: "avail", value: "Available in API", support: "explicit" },
        aggregate,
        title,
      ),
    ).toBe(true);
  });
});
