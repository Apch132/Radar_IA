import { describe, expect, it } from "vitest";

import {
  CONTEXT_BODY_MAX_CHARS,
  buildAnalysisContext,
} from "./analysis-context-builder.js";
import type { AnalysisArticleInput } from "./analysis-service-types.js";
import { unicodeLength } from "./validate-analysis-proposal.js";

function article(
  partial: Partial<AnalysisArticleInput> &
    Pick<AnalysisArticleInput, "articleId" | "role">,
): AnalysisArticleInput {
  return {
    sourceTier: "B",
    title: partial.title ?? `Title ${partial.articleId}`,
    url: partial.url ?? `https://example.com/${partial.articleId}`,
    summary: partial.summary ?? null,
    content: partial.content ?? null,
    attachedAt: partial.attachedAt ?? "2026-07-01T00:00:00.000Z",
    enrichmentType: partial.enrichmentType ?? null,
    ...partial,
  };
}

describe("analysis context builder", () => {
  it("17. keeps body under 12 000 chars", () => {
    const result = buildAnalysisContext({
      folderId: "f1",
      folderTitle: "Dossier test",
      articles: [
        article({
          articleId: "p1",
          role: "primary",
          content: "A".repeat(2_500),
        }),
      ],
      enrichmentFacts: [{ key: "date", value: "2026-07-01" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.totalBodyChars).toBeLessThanOrEqual(CONTEXT_BODY_MAX_CHARS);
  });

  it("18-19. truncates enrichments before primary and preserves primary meta", () => {
    const huge = "X".repeat(4_000);
    const result = buildAnalysisContext({
      folderId: "f1",
      folderTitle: "Dossier",
      articles: [
        article({
          articleId: "primary-1",
          role: "primary",
          title: "Primary title",
          url: "https://example.com/primary",
          sourceTier: "S",
          content: "PRIMARY_BODY_UNIQUE",
        }),
        article({
          articleId: "enr-old",
          role: "enrichment",
          content: huge,
          attachedAt: "2026-01-01T00:00:00.000Z",
        }),
        article({
          articleId: "enr-new",
          role: "enrichment",
          content: huge,
          attachedAt: "2026-06-01T00:00:00.000Z",
        }),
      ],
      enrichmentFacts: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bodyText).toContain("articleId=primary-1");
    expect(result.bodyText).toContain("PRIMARY_BODY_UNIQUE");
    expect(result.bodyText).toContain("https://example.com/primary");
    expect(result.bodyText).toContain("tier=S");
  });

  it("20. preserves URLs / IDs / tiers", () => {
    const result = buildAnalysisContext({
      folderId: "folder-xyz",
      folderTitle: "Titre",
      articles: [
        article({
          articleId: "art-42",
          role: "primary",
          url: "https://news.example/42",
          sourceTier: "A",
          content: "Contenu court",
        }),
      ],
      enrichmentFacts: [],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bodyText).toContain("folderId=folder-xyz");
    expect(result.bodyText).toContain("articleId=art-42");
    expect(result.bodyText).toContain("https://news.example/42");
    expect(result.bodyText).toContain("tier=A");
  });

  it("21. returns context_too_large when meta alone exceeds budget", () => {
    const many = Array.from({ length: 80 }, (_, i) =>
      article({
        articleId: `id-${i}-${"z".repeat(40)}`,
        role: i === 0 ? "primary" : "enrichment",
        title: `T-${"y".repeat(80)}-${i}`,
        url: `https://example.com/${"u".repeat(80)}/${i}`,
        content: "",
        attachedAt: new Date(2026, 0, i + 1).toISOString(),
      }),
    );
    const result = buildAnalysisContext({
      folderId: `folder-${"f".repeat(200)}`,
      folderTitle: "T".repeat(500),
      articles: many,
      enrichmentFacts: Array.from({ length: 50 }, (_, i) => ({
        key: `k${i}${"k".repeat(30)}`,
        value: `v${i}${"v".repeat(30)}`,
      })),
    });
    // Either reduced under budget or context_too_large — meta-heavy should tip.
    if (!result.ok) {
      expect(result.reason).toBe("context_too_large");
      expect(result.totalBodyChars).toBeGreaterThan(CONTEXT_BODY_MAX_CHARS);
    } else {
      expect(result.totalBodyChars).toBeLessThanOrEqual(CONTEXT_BODY_MAX_CHARS);
      expect(unicodeLength(result.bodyText)).toBe(result.totalBodyChars);
    }
  });
});
