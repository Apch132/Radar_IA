import { describe, expect, it, vi } from "vitest";

import { runCatchUp } from "./catch-up.js";

function prisma() {
  return {
    newsFolder: {
      findMany: vi.fn(async () => [
        {
          id: "folder-1",
          status: "open",
          folderPublication: null,
          articles: [{ article: {
            id: "article-1", sourceId: "qwen-blog",
            publishedAt: new Date("2026-07-01T00:00:00.000Z"), title: "Introducing Qwen3",
          } }],
        },
        {
          id: "published",
          status: "open",
          folderPublication: { mainMessageId: "msg-1" },
          articles: [{ article: {
            id: "article-2", sourceId: "openai-news",
            publishedAt: new Date("2026-07-01T00:00:00.000Z"), title: "GPT",
          } }],
        },
      ]),
    },
  };
}

describe("runCatchUp", () => {
  it("lists priority candidates during a dry run", async () => {
    const write = vi.fn();
    const candidates = await runCatchUp({ prisma: prisma(), write });
    expect(candidates).toEqual([expect.objectContaining({
      articleId: "article-1", sourceId: "qwen-blog", idempotencyKey: "publish:folder-1",
      title: "Introducing Qwen3",
    })]);
    expect(write).toHaveBeenCalled();
  });

  it("reanalyses each eligible folder once when executing", async () => {
    const reanalyze = vi.fn(async () => undefined);
    await runCatchUp({ prisma: prisma(), execute: true, reanalyze });
    expect(reanalyze).toHaveBeenCalledTimes(1);
    expect(reanalyze).toHaveBeenCalledWith("folder-1");
  });
});
