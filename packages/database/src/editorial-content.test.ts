import { describe, expect, it } from "vitest";

import {
  buildEditorialSnapshot,
  computeEditorialHash,
  isEditorialUnchanged,
} from "./editorial-content.js";

const existing = {
  sourceTier: "S",
  title: "  Introducing  Qwen 3 ",
  url: "https://example.test/news/qwen-3/?utm_source=rss",
  publishedAt: new Date("2026-07-01T00:00:00.000Z"),
  author: " Ada ",
  summary: "A  major\nannouncement",
  content: "The  model\nis available.",
  categories: ["Models", "Research"],
  feedFormat: "RSS",
  externalId: "qwen-3",
};

describe("editorial content identity", () => {
  it("ignores feed metadata, tracking params, whitespace, and category order", () => {
    const result = isEditorialUnchanged(existing, {
      ...existing,
      url: "https://EXAMPLE.test/news/qwen-3?utm_campaign=x#top",
      updatedAt: "2026-08-01T00:00:00.000Z",
      title: "Introducing Qwen 3",
      summary: "A major announcement",
      content: "The model is available.",
      categories: [" research ", "models"],
      publishedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(result.unchanged).toBe(true);
    expect(result.changedFields).toEqual([]);
  });

  it("detects real title and content changes", () => {
    expect(
      isEditorialUnchanged(existing, {
        ...existing,
        title: "Introducing Qwen 4",
        categories: existing.categories,
        publishedAt: existing.publishedAt.toISOString(),
      }).changedFields,
    ).toContain("title");
    expect(
      isEditorialUnchanged(existing, {
        ...existing,
        content: "A materially different body.",
        categories: existing.categories,
        publishedAt: existing.publishedAt.toISOString(),
      }).changedFields,
    ).toContain("content");
  });

  it("produces a stable canonical hash", () => {
    const first = computeEditorialHash(buildEditorialSnapshot(existing));
    const second = computeEditorialHash(
      buildEditorialSnapshot({
        ...existing,
        title: "Introducing Qwen 3",
        url: "https://example.test/news/qwen-3",
        categories: ["research", "models"],
      }),
    );
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});
