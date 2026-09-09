import { describe, expect, it } from "vitest";

import {
  buildEnrichmentPublicationContent,
  buildMainPublicationContent,
  buildThreadName,
  DISCORD_LIMITS,
  neutralizeMentions,
  PublicationContentError,
  sanitizeDiscordText,
  stripControlCharacters,
  stripHtml,
  truncateDiscordText,
  truncateEmbedDescription,
  truncateEmbedTitle,
  truncateMessageContent,
  truncateThreadName,
  embedCharacterCount,
  type BuildMainPublicationContentInput,
  type RenderedDiscordPayload,
} from "./index.js";

function baseMain(
  overrides: Partial<BuildMainPublicationContentInput> = {},
): BuildMainPublicationContentInput {
  return {
    folderId: "fld_abcdefghijklmnop",
    title: "OpenAI lance GPT-5",
    channelRole: "VEILLE_PERTINENTE",
    content: {
      summary: "OpenAI annonce le lancement de GPT-5 avec de nouvelles capacités.",
      primaryCategory: "model_release",
      publishWorthiness: "high",
      composite: 88,
    },
    sources: [
      {
        name: "OpenAI Blog",
        url: "https://openai.com/blog/gpt-5",
      },
    ],
    usefulDate: "2026-07-15T14:30:00.000Z",
    ...overrides,
  };
}

function assertPortCompatible(payload: RenderedDiscordPayload): void {
  expect(typeof payload.content).toBe("string");
  expect(Array.isArray(payload.embeds)).toBe(true);
  expect(payload.embeds.length).toBeLessThanOrEqual(1);
  for (const embed of payload.embeds) {
    if (embed.title !== undefined) expect(typeof embed.title).toBe("string");
    if (embed.description !== undefined) {
      expect(typeof embed.description).toBe("string");
    }
    if (embed.fields) {
      for (const field of embed.fields) {
        expect(typeof field.name).toBe("string");
        expect(typeof field.value).toBe("string");
      }
    }
    if (embed.footer) {
      expect(typeof embed.footer.text).toBe("string");
    }
  }
}

describe("buildMainPublicationContent", () => {
  it("1. rendu principal nominal", () => {
    const result = buildMainPublicationContent(baseMain());
    expect(result.channelRole).toBe("VEILLE_PERTINENTE");
    expect(result.payload.content).toContain("OpenAI lance GPT-5");
    expect(result.payload.content).toContain("https://openai.com/blog/gpt-5");
    expect(result.payload.embeds).toHaveLength(1);
    const embed = result.payload.embeds[0]!;
    expect(embed.title).toBe("OpenAI lance GPT-5");
    expect(embed.description).toContain("GPT-5");
    expect(embed.footer?.text).toBe("dossier:ijklmnop");
    expect(result.threadName.startsWith("Veille — ")).toBe(true);
    const fieldNames = (embed.fields ?? []).map((f) => f.name);
    expect(fieldNames).toContain("Catégorie");
    expect(fieldNames).toContain("Pertinence");
    expect(fieldNames).toContain("Sources");
    expect(fieldNames).toContain("Date");
    expect(embed.fields?.find((f) => f.name === "Date")?.value).toBe(
      "2026-07-15",
    );
    expect(embed.fields?.find((f) => f.name === "Pertinence")?.value).toBe(
      "88 · high",
    );
  });

  it("3. déterminisme", () => {
    const a = buildMainPublicationContent(baseMain());
    const b = buildMainPublicationContent(baseMain());
    expect(a).toEqual(b);
  });

  it("15. source sans URL", () => {
    const result = buildMainPublicationContent(
      baseMain({
        sources: [{ name: "Press Wire", url: null }],
      }),
    );
    const sources = result.payload.embeds[0]!.fields?.find(
      (f) => f.name === "Sources",
    );
    expect(sources?.value).toBe("Press Wire");
    expect(result.payload.content).not.toContain("http");
  });

  it("16. URL invalide ignorée", () => {
    const result = buildMainPublicationContent(
      baseMain({
        sources: [
          { name: "Bad", url: "ftp://evil.example/x" },
          { name: "Good", url: "https://ok.example/a" },
        ],
      }),
    );
    expect(result.warnings.some((w) => w.code === "url_invalid")).toBe(true);
    const sources = result.payload.embeds[0]!.fields?.find(
      (f) => f.name === "Sources",
    );
    expect(sources?.value).toContain("https://ok.example/a");
    expect(sources?.value).not.toContain("ftp://");
  });

  it("17. déduplication des sources", () => {
    const result = buildMainPublicationContent(
      baseMain({
        sources: [
          { name: "OpenAI Blog", url: "https://openai.com/blog/gpt-5" },
          { name: "OpenAI Blog", url: "https://openai.com/blog/gpt-5" },
        ],
      }),
    );
    expect(result.warnings.some((w) => w.code === "source_ignored")).toBe(
      true,
    );
    const sources = result.payload.embeds[0]!.fields?.find(
      (f) => f.name === "Sources",
    );
    expect(sources?.value?.split("\n")).toHaveLength(1);
  });

  it("18. absence de sources affichables", () => {
    const result = buildMainPublicationContent(
      baseMain({
        sources: [{ name: "", url: "https://x.example" }],
      }),
    );
    const fieldNames = (result.payload.embeds[0]!.fields ?? []).map(
      (f) => f.name,
    );
    expect(fieldNames).not.toContain("Sources");
    expect(
      result.warnings.some(
        (w) => w.code === "field_omitted" && w.detail === "Sources",
      ),
    ).toBe(true);
  });

  it("19. résumé minimal", () => {
    const result = buildMainPublicationContent(
      baseMain({
        content: {
          summary: "",
          primaryCategory: "other",
          publishWorthiness: "medium",
          composite: 70,
        },
      }),
    );
    expect(result.payload.embeds[0]!.description).toBe(
      "Résumé indisponible.",
    );
    expect(result.warnings.some((w) => w.code === "empty_fallback")).toBe(
      true,
    );
  });

  it("20. payload final compatible avec les contrats du futur port Discord", () => {
    const result = buildMainPublicationContent(baseMain());
    assertPortCompatible(result.payload);
    expect(result.payload.content.length).toBeLessThanOrEqual(
      DISCORD_LIMITS.MESSAGE_CONTENT,
    );
    const embed = result.payload.embeds[0]!;
    expect((embed.title ?? "").length).toBeLessThanOrEqual(
      DISCORD_LIMITS.EMBED_TITLE,
    );
    expect((embed.description ?? "").length).toBeLessThanOrEqual(
      DISCORD_LIMITS.EMBED_DESCRIPTION,
    );
    expect(embedCharacterCount(embed)).toBeLessThanOrEqual(
      DISCORD_LIMITS.EMBED_TOTAL,
    );
  });
});

describe("buildEnrichmentPublicationContent", () => {
  it("2. rendu enrichissement nominal", () => {
    const result = buildEnrichmentPublicationContent({
      folderId: "fld_abcdefghijklmnop",
      newFacts: [
        { key: "pricing", value: "available in API" },
        { key: "availability", value: "public preview" },
      ],
      newSources: [
        { name: "TechCrunch", url: "https://techcrunch.com/gpt-5" },
      ],
      aggregateFingerprint: "abcdef0123456789deadbeef",
    });
    expect(result.payload.embeds).toHaveLength(1);
    const embed = result.payload.embeds[0]!;
    expect(embed.title).toBe("Enrichissement");
    expect(embed.description).toContain("availability");
    expect(embed.description).toContain("pricing");
    // Deterministic fact order (key asc)
    const lines = embed.description!.split("\n");
    expect(lines[0]).toContain("availability");
    expect(embed.footer?.text).toContain("dossier:ijklmnop");
    expect(embed.footer?.text).toContain("abcdef01");
    expect(result.payload.content).toContain("https://techcrunch.com/gpt-5");
    // Does not copy main layout fields
    const names = (embed.fields ?? []).map((f) => f.name);
    expect(names).not.toContain("Catégorie");
    expect(names).not.toContain("Pertinence");
  });

  it("enrichment déterminisme", () => {
    const input = {
      folderId: "fld_1",
      newFacts: [{ key: "b", value: "2" }, { key: "a", value: "1" }],
      newSources: [{ name: "S", url: "https://s.example" }],
    };
    expect(buildEnrichmentPublicationContent(input)).toEqual(
      buildEnrichmentPublicationContent(input),
    );
  });

  it("enrichment vide → erreur métier", () => {
    expect(() =>
      buildEnrichmentPublicationContent({
        folderId: "fld_1",
        newFacts: [],
        newSources: [],
      }),
    ).toThrow(PublicationContentError);
  });
});

describe("sécurité du contenu", () => {
  it("4. neutralisation @everyone", () => {
    expect(neutralizeMentions("ping @everyone now")).not.toMatch(/@everyone/);
    const result = buildMainPublicationContent(
      baseMain({
        title: "Alert @everyone",
        content: {
          summary: "Contains @everyone mention",
          primaryCategory: "other",
          publishWorthiness: "medium",
          composite: 75,
        },
      }),
    );
    const blob = JSON.stringify(result.payload);
    expect(blob).not.toMatch(/(?<!\u200b)@everyone/i);
    expect(result.payload.content).toContain("@\u200beveryone");
  });

  it("5. neutralisation @here", () => {
    expect(neutralizeMentions("@here urgent")).toContain("@\u200bhere");
    const result = buildMainPublicationContent(
      baseMain({ title: "Go @here" }),
    );
    expect(result.payload.content).toContain("@\u200bhere");
  });

  it("6. neutralisation mentions utilisateur / rôle", () => {
    const text = neutralizeMentions("hi <@123456789012345678> and <@&987654321098765432>");
    expect(text).toContain("<@\u200b123456789012345678>");
    expect(text).toContain("<@&\u200b987654321098765432>");
    expect(text).not.toMatch(/<@[0-9]/);
    expect(text).not.toMatch(/<@&[0-9]/);
  });

  it("7. suppression HTML", () => {
    expect(stripHtml("<b>Bold</b> &amp; <script>x</script>")).toContain("Bold");
    expect(stripHtml("<b>Bold</b> &amp; <script>x</script>")).toContain("&");
    expect(stripHtml("<b>Bold</b>")).not.toContain("<b>");
    const result = buildMainPublicationContent(
      baseMain({
        content: {
          summary: "<p>Hello <strong>world</strong></p>",
          primaryCategory: "other",
          publishWorthiness: "low",
          composite: 70,
        },
      }),
    );
    expect(result.payload.embeds[0]!.description).toBe("Hello world");
  });

  it("8. suppression caractères de contrôle", () => {
    expect(stripControlCharacters("a\u0000b\u0007c")).toBe("abc");
    expect(sanitizeDiscordText("x\u0001y")).toBe("xy");
  });
});

describe("limites Discord et troncature", () => {
  it("9. troncature message", () => {
    const long = "x".repeat(DISCORD_LIMITS.MESSAGE_CONTENT + 50);
    const t = truncateMessageContent(long);
    expect(t.truncated).toBe(true);
    expect(t.text.length).toBe(DISCORD_LIMITS.MESSAGE_CONTENT);
    expect(t.text.endsWith("…")).toBe(true);
  });

  it("10. troncature titre embed", () => {
    const long = "T".repeat(DISCORD_LIMITS.EMBED_TITLE + 10);
    const t = truncateEmbedTitle(long);
    expect(t.truncated).toBe(true);
    expect(t.text.length).toBe(DISCORD_LIMITS.EMBED_TITLE);
    const result = buildMainPublicationContent(baseMain({ title: long }));
    expect(result.warnings.some((w) => w.code === "title_truncated")).toBe(
      true,
    );
    expect(result.payload.embeds[0]!.title!.length).toBeLessThanOrEqual(
      DISCORD_LIMITS.EMBED_TITLE,
    );
  });

  it("11. troncature description embed", () => {
    const long = "D".repeat(DISCORD_LIMITS.EMBED_DESCRIPTION + 20);
    const t = truncateEmbedDescription(long);
    expect(t.truncated).toBe(true);
    expect(t.text.length).toBe(DISCORD_LIMITS.EMBED_DESCRIPTION);
    const result = buildMainPublicationContent(
      baseMain({
        content: {
          summary: long,
          primaryCategory: "research",
          publishWorthiness: "medium",
          composite: 72,
        },
      }),
    );
    expect(result.warnings.some((w) => w.code === "summary_truncated")).toBe(
      true,
    );
  });

  it("12. respect du nombre de champs", () => {
    // Force many sources beyond display max + ensure fields stay ≤ EMBED_FIELDS_MAX
    const sources = Array.from({ length: 12 }, (_, i) => ({
      name: `Source ${String(i).padStart(2, "0")}`,
      url: `https://example.com/${i}`,
    }));
    const result = buildMainPublicationContent(baseMain({ sources }));
    expect((result.payload.embeds[0]!.fields ?? []).length).toBeLessThanOrEqual(
      DISCORD_LIMITS.EMBED_FIELDS_MAX,
    );
    const sourcesField = result.payload.embeds[0]!.fields?.find(
      (f) => f.name === "Sources",
    );
    expect(sourcesField?.value.split("\n").length).toBeLessThanOrEqual(
      DISCORD_LIMITS.SOURCES_DISPLAY_MAX,
    );
  });

  it("13. respect du total embed", () => {
    const fatSummary = "S".repeat(4000);
    const fatSources = Array.from({ length: 5 }, (_, i) => ({
      name: `N${i}-${"n".repeat(80)}`,
      url: `https://example.com/${"p".repeat(80)}/${i}`,
    }));
    const result = buildMainPublicationContent(
      baseMain({
        title: "T".repeat(200),
        content: {
          summary: fatSummary,
          primaryCategory: "benchmark",
          publishWorthiness: "high",
          composite: 90,
        },
        sources: fatSources,
      }),
    );
    expect(
      embedCharacterCount(result.payload.embeds[0]!),
    ).toBeLessThanOrEqual(DISCORD_LIMITS.EMBED_TOTAL);
  });

  it("14. troncature du nom de fil", () => {
    const longTitle = "A".repeat(200);
    const name = buildThreadName(longTitle);
    expect(name.length).toBeLessThanOrEqual(DISCORD_LIMITS.THREAD_NAME);
    expect(name.startsWith("Veille — ")).toBe(true);
    const t = truncateThreadName(`Veille — ${longTitle}`);
    expect(t.truncated).toBe(true);
    const result = buildMainPublicationContent(baseMain({ title: longTitle }));
    expect(result.threadName.length).toBeLessThanOrEqual(
      DISCORD_LIMITS.THREAD_NAME,
    );
    expect(
      result.warnings.some((w) => w.code === "thread_name_truncated"),
    ).toBe(true);
  });

  it("truncateDiscordText ne dépasse jamais la limite", () => {
    expect(truncateDiscordText("abc", 10)).toEqual({
      text: "abc",
      truncated: false,
    });
    expect(truncateDiscordText("abcdef", 4).text).toBe("abc…");
  });
});
