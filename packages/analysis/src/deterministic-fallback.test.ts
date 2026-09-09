import { describe, expect, it } from "vitest";

import { evaluateDeterministicFallback } from "./deterministic-fallback.js";

function evaluate(input: {
  title: string;
  sourceId?: string;
  sourceTier?: "S" | "B";
  hasMainPublication?: boolean;
}) {
  return evaluateDeterministicFallback({
    hasMainPublication: input.hasMainPublication ?? false,
    articles: [
      {
        articleId: "article-1",
        role: "primary",
        sourceId: input.sourceId,
        sourceTier: input.sourceTier ?? "S",
        title: input.title,
        url: "https://example.test/announcement",
        attachedAt: "2026-07-01T00:00:00.000Z",
      },
    ],
  });
}

describe("evaluateDeterministicFallback", () => {
  it("publishes an official Tier S new-model announcement", () => {
    const result = evaluate({
      sourceId: "official-future-source",
      title: "Introducing Atlas 3, our new model",
    });
    expect(result).toMatchObject({
      matched: true,
      decision: "publish",
      decisionMethod: "deterministic_fallback",
      ruleId: "official_introducing_phrase",
    });
  });

  it("matches a Cursor changelog-style title", () => {
    expect(
      evaluate({ sourceId: "cursor-changelog", title: "Cursor 1.4 release notes" }),
    ).toMatchObject({ matched: true, ruleId: "major_model_announcement" });
  });

  it.each([
    ["qwen-blog", "Announcing Qwen3, our new model"],
    ["meta-ai-blog", "Llama 4 is now available"],
    ["xai-news", "Grok 4 released today"],
  ])("matches major %s-style titles on Tier S", (sourceId, title) => {
    expect(evaluate({ sourceId, title })).toMatchObject({ matched: true });
  });

  it("does not match Tier B media without a whitelist entry", () => {
    expect(
      evaluate({
        sourceId: "media-example",
        sourceTier: "B",
        title: "Announcing Qwen3, our new model",
      }),
    ).toEqual({ matched: false, reason: "source_not_whitelisted" });
  });

  it("does not publish a folder with a main publication", () => {
    expect(
      evaluate({
        sourceId: "openai-news",
        title: "Introducing GPT-5",
        hasMainPublication: true,
      }),
    ).toEqual({ matched: false, reason: "has_main_publication" });
  });

  it("only matches Windsurf from a whitelist or Tier S", () => {
    expect(
      evaluate({
        sourceId: "windsurf-news",
        sourceTier: "B",
        title: "Windsurf 2.0 release",
      }),
    ).toEqual({ matched: false, reason: "source_not_whitelisted" });
    expect(
      evaluate({
        sourceId: "windsurf-news",
        title: "Windsurf 2.0 release",
      }),
    ).toMatchObject({ matched: true });
  });
});
