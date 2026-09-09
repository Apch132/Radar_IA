import { describe, expect, it } from "vitest";

import { createMatchingEngine } from "./matching-engine.js";
import {
  extractEventFingerprint,
  normalizeToken,
} from "./matching-signals.js";
import type {
  MatchingArticleInput,
  MatchingCandidateFolder,
} from "./matching-types.js";

function article(
  overrides: Partial<MatchingArticleInput> &
    Pick<MatchingArticleInput, "title" | "url">,
): MatchingArticleInput {
  return {
    sourceId: "source-a",
    sourceTier: "E",
    categories: [],
    ...overrides,
  };
}

function folderFromArticle(
  id: string,
  seed: MatchingArticleInput,
  overrides: Partial<MatchingCandidateFolder> = {},
): MatchingCandidateFolder {
  return {
    id,
    status: "open",
    title: seed.title,
    fingerprint: extractEventFingerprint(seed),
    ...overrides,
  };
}

describe("createMatchingEngine", () => {
  const engine = createMatchingEngine();

  it("attaches multi-source coverage of the same event with novel confirmation", () => {
    const primary = article({
      sourceId: "openai-blog",
      sourceTier: "S",
      title: "OpenAI launches GPT-4o model",
      url: "https://openai.com/blog/gpt-4o",
      publishedAt: "2026-07-01T10:00:00.000Z",
      summary: "OpenAI announces the launch of GPT-4o.",
      categories: ["models"],
    });
    const existing = folderFromArticle("fld_1", primary);

    const press = article({
      sourceId: "tech-press",
      sourceTier: "E",
      title: "OpenAI launches GPT-4o and opens waitlist",
      url: "https://news.example/openai-gpt-4o",
      publishedAt: "2026-07-01T12:00:00.000Z",
      summary: "OpenAI launches GPT-4o and opens a waitlist for access.",
      categories: ["models"],
    });

    const result = engine.evaluate(press, [existing]);

    expect(result.issue).toBe("attach_enrich");
    expect(result.folderId).toBe("fld_1");
    expect(result.confidence).toBe("high");
    expect(result.favorableSignals).toEqual(
      expect.arrayContaining([
        "same_entities",
        "same_announcement_nature",
        "same_version",
      ]),
    );
    expect(result.enrichmentFacts?.some((f) => f.key === "availability:waitlist")).toBe(
      true,
    );
    expect(result.proposalOrigin).toBe("rule");
  });

  it("creates a new dossier for a distinct milestone of an existing product line", () => {
    const gpt4 = article({
      sourceId: "openai-blog",
      sourceTier: "S",
      title: "OpenAI launches GPT-4",
      url: "https://openai.com/blog/gpt-4",
      publishedAt: "2026-06-01T10:00:00.000Z",
      summary: "OpenAI launches GPT-4.",
    });
    const existing = folderFromArticle("fld_gpt4", gpt4);

    const gpt5 = article({
      sourceId: "openai-blog",
      sourceTier: "S",
      title: "OpenAI launches GPT-5",
      url: "https://openai.com/blog/gpt-5",
      publishedAt: "2026-07-10T10:00:00.000Z",
      summary: "OpenAI launches GPT-5 with new capabilities.",
    });

    const result = engine.evaluate(gpt5, [existing]);

    expect(result.issue).toBe("create_dossier");
    expect(result.folderId).toBeNull();
    expect(result.confidence).toBe("none");
    expect(result.motiveCodes).toContain("distinct_event");
    expect(result.folderTitle).toBe("OpenAI launches GPT-5");
    expect(result.unfavorableSignals).toContain("different_version");
  });

  it("marks editorial reprints without new facts as duplicate_editorial", () => {
    const primary = article({
      sourceId: "openai-blog",
      sourceTier: "S",
      title: "OpenAI launches GPT-4o",
      url: "https://openai.com/blog/gpt-4o",
      publishedAt: "2026-07-01T10:00:00.000Z",
      summary: "OpenAI launches GPT-4o.",
    });
    const existing = folderFromArticle("fld_1", primary);

    const reprint = article({
      sourceId: "aggregator",
      sourceTier: "E",
      title: "OpenAI launches GPT-4o",
      url: "https://aggregator.example/openai-gpt-4o-rehash",
      publishedAt: "2026-07-02T09:00:00.000Z",
      summary: "OpenAI launches GPT-4o, according to the official blog.",
    });

    const result = engine.evaluate(reprint, [existing]);

    expect(result.issue).toBe("duplicate_editorial");
    expect(result.folderId).toBe("fld_1");
    expect(["high", "medium"]).toContain(result.confidence);
    expect(result.motiveCodes).toContain("no_novel_information");
    expect(result.unfavorableSignals).toContain("absence_of_new_value");
    expect(result.enrichmentFacts).toBeNull();
  });

  it("keeps nearby themes as separate events when entities differ", () => {
    const openai = article({
      sourceId: "openai-blog",
      sourceTier: "S",
      title: "OpenAI launches GPT-4o",
      url: "https://openai.com/blog/gpt-4o",
      publishedAt: "2026-07-01T10:00:00.000Z",
      summary: "OpenAI launches GPT-4o.",
      categories: ["models", "generative-ai"],
    });
    const existing = folderFromArticle("fld_openai", openai);

    const anthropic = article({
      sourceId: "anthropic-blog",
      sourceTier: "S",
      title: "Anthropic launches Claude 4",
      url: "https://anthropic.com/news/claude-4",
      publishedAt: "2026-07-01T11:00:00.000Z",
      summary: "Anthropic launches Claude 4.",
      categories: ["models", "generative-ai"],
    });

    const result = engine.evaluate(anthropic, [existing]);

    expect(result.issue).toBe("create_dossier");
    expect(result.confidence).toBe("none");
    expect(result.unfavorableSignals).toEqual(
      expect.arrayContaining(["different_product_org"]),
    );
  });

  it("returns ambiguous_no_action when content is too thin to decide", () => {
    const folder: MatchingCandidateFolder = {
      id: "fld_theme",
      status: "open",
      title: "Industry notes on generative AI",
      fingerprint: {
        entities: ["generative ai"],
        announcementNature: "other",
        knownFactKeys: [],
        categories: ["generative-ai"],
        canonicalUrls: ["https://example.com/theme"],
        referenceDate: "2026-07-01T00:00:00.000Z",
      },
    };

    const candidate = article({
      sourceId: "press",
      sourceTier: "E",
      title: "Why generative AI matters this week",
      url: "https://press.example/generative-ai-week",
      publishedAt: "2026-07-03T00:00:00.000Z",
      summary: "A broad look at generative AI trends.",
      categories: ["generative-ai"],
    });

    const result = engine.evaluate(candidate, [folder]);

    expect(result.issue).toBe("ambiguous_no_action");
    expect(result.confidence).toBe("low");
    expect(result.motiveCodes).toContain("insufficient_primary_information");
  });

  it("returns ambiguous_no_action on low-confidence theme-only overlap", () => {
    const folder: MatchingCandidateFolder = {
      id: "fld_theme",
      status: "open",
      title: "Industry notes on generative AI",
      fingerprint: {
        entities: ["generative ai"],
        announcementNature: "other",
        knownFactKeys: [],
        categories: ["generative-ai", "benchmarks"],
        canonicalUrls: ["https://example.com/theme"],
        referenceDate: "2026-07-01T00:00:00.000Z",
      },
    };

    const candidate = article({
      sourceId: "press",
      sourceTier: "E",
      title: "Benchmarks debate around generative AI continues",
      url: "https://press.example/generative-ai-benchmarks-debate",
      publishedAt: "2026-07-03T00:00:00.000Z",
      summary:
        "Commentators revisit generative AI benchmarks without naming a product launch.",
      categories: ["generative-ai", "benchmarks"],
    });

    const result = engine.evaluate(candidate, [folder]);

    expect(result.issue).toBe("ambiguous_no_action");
    expect(result.confidence).toBe("low");
    expect(result.motiveCodes).toContain("low_confidence_match");
  });

  it("returns ambiguous_no_action when multiple folders are equally plausible", () => {
    const seed = article({
      sourceId: "openai-blog",
      sourceTier: "S",
      title: "OpenAI launches GPT-4o",
      url: "https://openai.com/blog/gpt-4o",
      publishedAt: "2026-07-01T10:00:00.000Z",
      summary: "OpenAI launches GPT-4o.",
    });
    const a = folderFromArticle("fld_a", seed);
    const b = folderFromArticle("fld_b", {
      ...seed,
      url: "https://openai.com/blog/gpt-4o-mirror",
    });

    const reprint = article({
      sourceId: "press",
      sourceTier: "E",
      title: "OpenAI launches GPT-4o",
      url: "https://press.example/gpt-4o",
      publishedAt: "2026-07-01T15:00:00.000Z",
      summary: "OpenAI launches GPT-4o.",
    });

    const result = engine.evaluate(reprint, [a, b]);

    expect(result.issue).toBe("ambiguous_no_action");
    expect(result.motiveCodes).toContain("multiple_plausible_folders");
    expect(result.folderId).toBeNull();
  });

  it("creates a dossier when no candidates are provided", () => {
    const result = engine.evaluate(
      article({
        sourceId: "mistral",
        sourceTier: "S",
        title: "Mistral releases Mixtral 8x22B",
        url: "https://mistral.ai/news/mixtral-8x22b",
        publishedAt: "2026-07-05T08:00:00.000Z",
        summary: "Mistral releases Mixtral 8x22B.",
      }),
      [],
    );

    expect(result.issue).toBe("create_dossier");
    expect(result.confidence).toBe("none");
    expect(result.motiveCodes).toContain("no_credible_candidate");
    expect(result.folderTitle).toContain("Mixtral");
  });

  it("ignores closed folders for automatic attach", () => {
    const primary = article({
      sourceId: "openai-blog",
      sourceTier: "S",
      title: "OpenAI launches GPT-4o",
      url: "https://openai.com/blog/gpt-4o",
      publishedAt: "2026-07-01T10:00:00.000Z",
      summary: "OpenAI launches GPT-4o.",
    });
    const closed = folderFromArticle("fld_closed", primary, {
      status: "closed",
    });

    const reprint = article({
      sourceId: "press",
      sourceTier: "E",
      title: "OpenAI launches GPT-4o",
      url: "https://press.example/gpt-4o",
      publishedAt: "2026-07-02T10:00:00.000Z",
      summary: "OpenAI launches GPT-4o.",
    });

    const result = engine.evaluate(reprint, [closed]);

    expect(result.issue).toBe("create_dossier");
    expect(result.folderId).toBeNull();
  });

  it("exposes an explainable justification and structured signals", () => {
    const result = engine.evaluate(
      article({
        title: "OpenAI launches GPT-4o",
        url: "https://openai.com/blog/gpt-4o",
        summary: "OpenAI launches GPT-4o.",
      }),
      [],
    );

    expect(result.justification).toContain("issue=create_dossier");
    expect(result.justification).toContain("confidence=none");
    expect(result.motiveCodes.length).toBeGreaterThan(0);
    expect(result.reevaluable).toBe(true);
  });

  it("is deterministic for identical inputs", () => {
    const input = article({
      sourceId: "press",
      sourceTier: "E",
      title: "Anthropic launches Claude 4 and confirms EU availability",
      url: "https://press.example/claude-4",
      publishedAt: "2026-07-08T10:00:00.000Z",
      summary: "Anthropic launches Claude 4 and confirms EU availability.",
    });
    const existing = folderFromArticle(
      "fld_1",
      article({
        sourceId: "anthropic",
        sourceTier: "S",
        title: "Anthropic launches Claude 4",
        url: "https://anthropic.com/news/claude-4",
        publishedAt: "2026-07-08T08:00:00.000Z",
        summary: "Anthropic launches Claude 4.",
      }),
    );

    const first = engine.evaluate(input, [existing]);
    const second = engine.evaluate(input, [existing]);

    expect(first).toEqual(second);
  });

  it("treats incompatible announcement natures as a blocking conflict", () => {
    const hiringish: MatchingCandidateFolder = {
      id: "fld_hire",
      status: "open",
      title: "OpenAI hiring research leads",
      fingerprint: {
        entities: ["openai"],
        productOrOrg: "openai",
        announcementNature: "acquisition",
        knownFactKeys: [],
        categories: ["company"],
        canonicalUrls: ["https://example.com/openai-hiring"],
        referenceDate: "2026-07-01T00:00:00.000Z",
      },
    };

    const product = article({
      sourceId: "openai-blog",
      sourceTier: "S",
      title: "OpenAI launches GPT-4o",
      url: "https://openai.com/blog/gpt-4o",
      publishedAt: "2026-07-01T10:00:00.000Z",
      summary: "OpenAI launches GPT-4o.",
    });

    const result = engine.evaluate(product, [hiringish]);

    expect(result.issue).toBe("create_dossier");
    expect(result.unfavorableSignals).toContain(
      "incompatible_announcement_nature",
    );
  });

  it("normalizes tokens stably for comparisons", () => {
    expect(normalizeToken("  GPT-4o  ")).toBe("gpt-4o");
    expect(normalizeToken("OpenAI")).toBe("openai");
  });
});
