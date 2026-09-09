import { describe, expect, it, vi } from "vitest";

import {
  ArticleNormalizationError,
  InvalidArticleUrlError,
  MissingArticleTitleError,
  MissingArticleUrlError,
  canonicalizeArticleUrl,
  normalizeArticle,
  normalizeFeedArticles,
  parseFeed,
  type NormalizedArticle,
  type ParsedFeed,
  type ParsedFeedItem,
  type SourceDefinition,
} from "./index.js";

const SOURCE: SourceDefinition = {
  id: "example-feed",
  name: "Example Feed",
  url: "https://example.com/feed.xml",
  tier: "A",
  enabled: true,
  provider: "rss",
};

const RSS_ITEM_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Radar Feed</title>
    <link>https://example.com/</link>
    <description>Veille IA</description>
    <item>
      <title>  Article   One  </title>
      <link>https://Example.com:443/a1?utm_source=rss#section</link>
      <guid>guid-rss-1</guid>
      <pubDate>Mon, 14 Jul 2025 12:00:00 GMT</pubDate>
      <author>  Alice  </author>
      <description>  Summary text  </description>
      <content:encoded><![CDATA[  <p>Full body</p>  ]]></content:encoded>
      <category> AI </category>
      <category>Research</category>
      <category>ai</category>
      <category>  </category>
    </item>
  </channel>
</rss>`;

const ATOM_ITEM_XML = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Radar</title>
  <link href="https://example.com/" rel="alternate"/>
  <updated>2025-07-14T10:00:00Z</updated>
  <entry>
    <title>Entry One</title>
    <link href="https://example.com/e1" rel="alternate"/>
    <id>urn:uuid:11111111-1111-1111-1111-111111111111</id>
    <published>2025-07-13T12:00:00Z</published>
    <author><name>Bob</name></author>
    <summary>Atom summary</summary>
    <content type="html">Atom content</content>
    <category term="Models"/>
    <category term="models"/>
  </entry>
</feed>`;

function item(overrides: Partial<ParsedFeedItem> = {}): ParsedFeedItem {
  return {
    title: "Title",
    link: "https://example.com/article",
    id: "ext-1",
    summary: null,
    author: null,
    publishedAt: null,
    categories: [],
    content: null,
    ...overrides,
  };
}

function feed(
  format: ParsedFeed["format"] = "rss",
  items: ParsedFeedItem[] = [item()],
): ParsedFeed {
  return {
    format,
    title: "Feed",
    description: null,
    link: "https://example.com/",
    language: null,
    updatedAt: null,
    items,
  };
}

describe("canonicalizeArticleUrl", () => {
  it("accepts a valid HTTPS URL", () => {
    expect(canonicalizeArticleUrl("https://example.com/a")).toBe(
      "https://example.com/a",
    );
  });

  it("accepts a valid HTTP URL", () => {
    expect(canonicalizeArticleUrl("http://example.com/a")).toBe(
      "http://example.com/a",
    );
  });

  it("rejects a relative URL", () => {
    expect(() => canonicalizeArticleUrl("/relative/path")).toThrow(
      InvalidArticleUrlError,
    );
  });

  it("rejects a disallowed protocol", () => {
    expect(() => canonicalizeArticleUrl("ftp://example.com/a")).toThrow(
      InvalidArticleUrlError,
    );
  });

  it("rejects credentials", () => {
    expect(() =>
      canonicalizeArticleUrl("https://user:pass@example.com/a"),
    ).toThrow(InvalidArticleUrlError);
  });

  it("strips the fragment", () => {
    expect(canonicalizeArticleUrl("https://example.com/a#frag")).toBe(
      "https://example.com/a",
    );
  });

  it("normalizes default HTTPS port", () => {
    expect(canonicalizeArticleUrl("https://example.com:443/a")).toBe(
      "https://example.com/a",
    );
  });

  it("normalizes default HTTP port", () => {
    expect(canonicalizeArticleUrl("http://example.com:80/a")).toBe(
      "http://example.com/a",
    );
  });

  it("preserves non-default ports", () => {
    expect(canonicalizeArticleUrl("https://example.com:8443/a")).toBe(
      "https://example.com:8443/a",
    );
  });

  it("lowercases the hostname", () => {
    expect(canonicalizeArticleUrl("https://Example.COM/a")).toBe(
      "https://example.com/a",
    );
  });

  it("preserves the query string including tracking params", () => {
    expect(
      canonicalizeArticleUrl(
        "https://example.com/a?utm_source=rss&id=1",
      ),
    ).toBe("https://example.com/a?utm_source=rss&id=1");
  });
});

describe("normalizeArticle", () => {
  it("normalizes an RSS article", () => {
    const parsed = parseFeed(RSS_ITEM_XML);
    const article = normalizeArticle(SOURCE, parsed, parsed.items[0]!);

    expect(article).toEqual({
      sourceId: "example-feed",
      sourceTier: "A",
      externalId: "guid-rss-1",
      title: "Article One",
      url: "https://example.com/a1?utm_source=rss",
      publishedAt: "2025-07-14T12:00:00.000Z",
      author: "Alice",
      summary: "Summary text",
      content: "<p>Full body</p>",
      categories: ["AI", "Research"],
      feedFormat: "rss",
    } satisfies NormalizedArticle);
  });

  it("normalizes an Atom article", () => {
    const parsed = parseFeed(ATOM_ITEM_XML);
    const article = normalizeArticle(SOURCE, parsed, parsed.items[0]!);

    expect(article.sourceId).toBe("example-feed");
    expect(article.sourceTier).toBe("A");
    expect(article.feedFormat).toBe("atom");
    expect(article.externalId).toBe(
      "urn:uuid:11111111-1111-1111-1111-111111111111",
    );
    expect(article.title).toBe("Entry One");
    expect(article.url).toBe("https://example.com/e1");
    expect(article.publishedAt).toBe("2025-07-13T12:00:00.000Z");
    expect(article.author).toBe("Bob");
    expect(article.summary).toBe("Atom summary");
    expect(article.content).toBe("Atom content");
    expect(article.categories).toEqual(["Models"]);
  });

  it("copies sourceId from the source definition", () => {
    const article = normalizeArticle(SOURCE, feed(), item());
    expect(article.sourceId).toBe(SOURCE.id);
  });

  it("copies sourceTier from the source definition", () => {
    const article = normalizeArticle(SOURCE, feed(), item());
    expect(article.sourceTier).toBe("A");
  });

  it("copies feedFormat from the feed", () => {
    expect(normalizeArticle(SOURCE, feed("atom"), item()).feedFormat).toBe(
      "atom",
    );
  });

  it("trims the title", () => {
    expect(
      normalizeArticle(SOURCE, feed(), item({ title: "  Hello  " })).title,
    ).toBe("Hello");
  });

  it("collapses peripheral and internal title whitespace", () => {
    expect(
      normalizeArticle(SOURCE, feed(), item({ title: "  Hello   World  " }))
        .title,
    ).toBe("Hello World");
  });

  it("rejects a missing title", () => {
    expect(() =>
      normalizeArticle(SOURCE, feed(), item({ title: null })),
    ).toThrow(MissingArticleTitleError);
  });

  it("rejects an empty title", () => {
    expect(() =>
      normalizeArticle(SOURCE, feed(), item({ title: "   " })),
    ).toThrow(MissingArticleTitleError);
  });

  it("does not fabricate a title from summary or content", () => {
    expect(() =>
      normalizeArticle(
        SOURCE,
        feed(),
        item({
          title: null,
          summary: "Would-be title",
          content: "Also not a title",
        }),
      ),
    ).toThrow(MissingArticleTitleError);
  });

  it("rejects a missing URL", () => {
    expect(() =>
      normalizeArticle(SOURCE, feed(), item({ link: null })),
    ).toThrow(MissingArticleUrlError);
  });

  it("rejects an empty URL", () => {
    expect(() =>
      normalizeArticle(SOURCE, feed(), item({ link: "  " })),
    ).toThrow(MissingArticleUrlError);
  });

  it("rejects a relative URL", () => {
    expect(() =>
      normalizeArticle(SOURCE, feed(), item({ link: "/path" })),
    ).toThrow(InvalidArticleUrlError);
  });

  it("preserves externalId when present", () => {
    expect(
      normalizeArticle(SOURCE, feed(), item({ id: "  keep-me  " })).externalId,
    ).toBe("keep-me");
  });

  it("omits externalId when absent", () => {
    const article = normalizeArticle(SOURCE, feed(), item({ id: null }));
    expect(article).not.toHaveProperty("externalId");
  });

  it("does not use URL as externalId", () => {
    const article = normalizeArticle(
      SOURCE,
      feed(),
      item({ id: null, link: "https://example.com/only-url" }),
    );
    expect(article.externalId).toBeUndefined();
    expect(article.url).toBe("https://example.com/only-url");
  });

  it("never uses an ETag as externalId", () => {
    const etag = '"abc123"';
    const article = normalizeArticle(
      SOURCE,
      feed(),
      item({ id: null }),
    );
    expect(article.externalId).toBeUndefined();
    expect(JSON.stringify(article)).not.toContain(etag);
  });

  it("converts a valid date to ISO UTC", () => {
    const publishedAt = new Date("2025-07-14T12:00:00.000Z");
    expect(
      normalizeArticle(SOURCE, feed(), item({ publishedAt })).publishedAt,
    ).toBe("2025-07-14T12:00:00.000Z");
  });

  it("omits a missing date", () => {
    const article = normalizeArticle(
      SOURCE,
      feed(),
      item({ publishedAt: null }),
    );
    expect(article).not.toHaveProperty("publishedAt");
  });

  it("ignores an invalid date without inventing one", () => {
    const article = normalizeArticle(
      SOURCE,
      feed(),
      item({ publishedAt: new Date("not-a-date") }),
    );
    expect(article).not.toHaveProperty("publishedAt");
  });

  it("trims author", () => {
    expect(
      normalizeArticle(SOURCE, feed(), item({ author: "  Carol  " })).author,
    ).toBe("Carol");
  });

  it("accepts a missing author", () => {
    const article = normalizeArticle(SOURCE, feed(), item({ author: null }));
    expect(article).not.toHaveProperty("author");
  });

  it("preserves summary as provided after trim", () => {
    expect(
      normalizeArticle(
        SOURCE,
        feed(),
        item({ summary: "  <b>raw</b>  " }),
      ).summary,
    ).toBe("<b>raw</b>");
  });

  it("preserves content as provided after trim", () => {
    expect(
      normalizeArticle(
        SOURCE,
        feed(),
        item({ content: "  <p>raw</p>  " }),
      ).content,
    ).toBe("<p>raw</p>");
  });

  it("returns an empty categories array when none", () => {
    expect(
      normalizeArticle(SOURCE, feed(), item({ categories: [] })).categories,
    ).toEqual([]);
  });

  it("keeps multiple categories in first-seen order", () => {
    expect(
      normalizeArticle(
        SOURCE,
        feed(),
        item({ categories: ["Beta", "Alpha"] }),
      ).categories,
    ).toEqual(["Beta", "Alpha"]);
  });

  it("trims categories", () => {
    expect(
      normalizeArticle(
        SOURCE,
        feed(),
        item({ categories: ["  Alpha  "] }),
      ).categories,
    ).toEqual(["Alpha"]);
  });

  it("deduplicates categories case-insensitively", () => {
    expect(
      normalizeArticle(
        SOURCE,
        feed(),
        item({ categories: ["AI", "ai", "Ai"] }),
      ).categories,
    ).toEqual(["AI"]);
  });

  it("drops empty categories", () => {
    expect(
      normalizeArticle(
        SOURCE,
        feed(),
        item({ categories: ["", "  ", "Keep"] }),
      ).categories,
    ).toEqual(["Keep"]);
  });

  it("omits score and LLM fields", () => {
    const article = normalizeArticle(SOURCE, feed(), item());
    expect(article).not.toHaveProperty("score");
    expect(article).not.toHaveProperty("importance");
    expect(article).not.toHaveProperty("language");
    expect(article).not.toHaveProperty("llmSummary");
  });

  it("is deterministic", () => {
    const parsedItem = item({
      title: " Same ",
      link: "https://Example.com:443/x?q=1#h",
      categories: ["A", "a", "B"],
      publishedAt: new Date("2025-01-01T00:00:00.000Z"),
    });
    const a = normalizeArticle(SOURCE, feed(), parsedItem);
    const b = normalizeArticle(SOURCE, feed(), parsedItem);
    expect(a).toEqual(b);
  });

  it("does not mutate the source", () => {
    const source = { ...SOURCE };
    const before = structuredClone(source);
    normalizeArticle(source, feed(), item());
    expect(source).toEqual(before);
  });

  it("does not mutate the feed", () => {
    const parsed = feed("rss", [item()]);
    const before = structuredClone(parsed);
    normalizeArticle(SOURCE, parsed, parsed.items[0]!);
    expect(parsed).toEqual(before);
  });

  it("does not mutate feed items", () => {
    const parsedItem = item({ categories: ["AI", "ML"] });
    const before = structuredClone(parsedItem);
    normalizeArticle(SOURCE, feed(), parsedItem);
    expect(parsedItem).toEqual(before);
  });

  it("performs no network I/O", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    normalizeArticle(SOURCE, feed(), item());
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("normalizeFeedArticles", () => {
  it("rejects an invalid item without blocking the following ones", () => {
    const parsed = feed("rss", [
      item({ title: null, id: "bad" }),
      item({ title: "Good", id: "good", link: "https://example.com/good" }),
      item({ link: "ftp://example.com/x", id: "bad-url" }),
    ]);

    const result = normalizeFeedArticles(SOURCE, parsed);

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]!.externalId).toBe("good");
    expect(result.rejected).toHaveLength(2);
    expect(result.rejected[0]).toMatchObject({
      index: 0,
      externalId: "bad",
      category: "MissingArticleTitleError",
    });
    expect(result.rejected[1]).toMatchObject({
      index: 2,
      externalId: "bad-url",
      category: "InvalidArticleUrlError",
    });
  });

  it("exposes a stable public error category and safe message", () => {
    const result = normalizeFeedArticles(
      SOURCE,
      feed("rss", [item({ title: null, id: "x" })]),
    );
    expect(result.rejected[0]!.category).toBe("MissingArticleTitleError");
    expect(result.rejected[0]!.message).toBe("Article title is required.");
    expect(result.rejected[0]!.message).not.toMatch(/Would-be|Full body/i);
  });

  it("throws stable public errors from normalizeArticle", () => {
    expect(() => normalizeArticle(SOURCE, feed(), item({ title: null }))).toThrow(
      ArticleNormalizationError,
    );
    try {
      normalizeArticle(SOURCE, feed(), item({ title: null }));
    } catch (error) {
      expect(error).toBeInstanceOf(MissingArticleTitleError);
      expect((error as Error).name).toBe("MissingArticleTitleError");
    }
  });
});
