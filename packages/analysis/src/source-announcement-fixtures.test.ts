import { describe, expect, it } from "vitest";

import { evaluateDeterministicFallback } from "./deterministic-fallback.js";

const fixtures = [
  { sourceId: "cursor-changelog", title: "Cursor 1.5 release notes" },
  { sourceId: "cursor-blog", title: "Introducing Cursor 2.0" },
  { sourceId: "qwen-blog", title: "Announcing Qwen3, our new model" },
  { sourceId: "xai-official", title: "Grok 4 is now available" },
  { sourceId: "meta-ai-blog", title: "Llama 4 released today" },
  { sourceId: "windsurf-official", title: "Windsurf 2.0 release" },
] as const;

describe("local official announcement title fixtures", () => {
  it.each(fixtures)("parses $sourceId: $title", ({ sourceId, title }) => {
    const result = evaluateDeterministicFallback({
      hasMainPublication: false,
      articles: [{
        articleId: "fixture",
        role: "primary",
        sourceId,
        sourceTier: "S",
        title,
        url: "https://fixtures.test/announcement",
        attachedAt: "2026-07-01T00:00:00.000Z",
      }],
    });
    expect(result).toMatchObject({ matched: true, decision: "publish" });
  });
});
