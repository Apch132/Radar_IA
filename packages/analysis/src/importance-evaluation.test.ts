import { describe, expect, it } from "vitest";

import { evaluateImportance } from "./importance-evaluation.js";
import {
  OFFICIAL_PUBLISHERS,
  OFFICIAL_WHITELIST_SOURCE_IDS,
  isOfficialWhitelistSource,
  resolveOfficialPublisher,
} from "./official-whitelist.js";

describe("official whitelist", () => {
  it("covers the Correctif 2 publisher set", () => {
    expect(OFFICIAL_PUBLISHERS).toEqual([
      "OpenAI",
      "Anthropic",
      "Google",
      "DeepMind",
      "Meta",
      "Mistral",
      "Cursor",
      "Qwen",
      "DeepSeek",
      "AI2",
      "Ollama",
      "Hugging Face",
    ]);
    expect(OFFICIAL_WHITELIST_SOURCE_IDS.length).toBeGreaterThanOrEqual(12);
  });

  it("maps source ids to publishers", () => {
    expect(resolveOfficialPublisher("openai-news")).toBe("OpenAI");
    expect(resolveOfficialPublisher("anthropic-news")).toBe("Anthropic");
    expect(isOfficialWhitelistSource("qwen-blog")).toBe(true);
    expect(isOfficialWhitelistSource("actuia")).toBe(false);
  });
});

describe("importance evaluation", () => {
  it("marks official model launches as critical", () => {
    const result = evaluateImportance({
      articles: [
        {
          articleId: "a1",
          role: "primary",
          sourceId: "openai-news",
          sourceTier: "S",
          title: "Introducing GPT-5 — now generally available",
          url: "https://example.test/gpt5",
          attachedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    });
    expect(result.level).toBe("critical");
    expect(result.signals).toEqual(
      expect.arrayContaining([
        "official_publisher",
        "tier_s",
        "new_model",
        "general_availability",
      ]),
    );
  });

  it("marks press chatter as low/medium without official whitelist", () => {
    const result = evaluateImportance({
      articles: [
        {
          articleId: "a2",
          role: "primary",
          sourceId: "actuia",
          sourceTier: "B",
          title: "Weekly roundup of AI links",
          url: "https://example.test/roundup",
          attachedAt: "2026-08-01T00:00:00.000Z",
        },
      ],
    });
    expect(result.level).toBe("low");
  });
});
