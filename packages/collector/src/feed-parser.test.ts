import { describe, expect, it } from "vitest";

import {
  InvalidXmlError,
  UnrecognizedFeedFormatError,
  parseFeed,
} from "./index.js";

const RSS_VALID = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Radar Feed</title>
    <link>https://example.com/</link>
    <description>Veille IA</description>
    <language>fr-FR</language>
    <lastBuildDate>Mon, 14 Jul 2025 10:00:00 GMT</lastBuildDate>
    <item>
      <title>Article One</title>
      <link>https://example.com/a1</link>
      <guid isPermaLink="true">https://example.com/a1</guid>
      <description>Summary one</description>
      <author>alice@example.com</author>
      <category>AI</category>
      <category>ML</category>
      <pubDate>Sun, 13 Jul 2025 09:00:00 GMT</pubDate>
      <content:encoded><![CDATA[<p>Full body</p>]]></content:encoded>
    </item>
    <item>
      <title>Article Two</title>
      <link>https://example.com/a2</link>
      <description>Summary two</description>
    </item>
  </channel>
</rss>`;

const ATOM_VALID = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en">
  <title>Atom Radar</title>
  <subtitle>Atom subtitle</subtitle>
  <link href="https://example.com/atom" rel="self"/>
  <link href="https://example.com/" rel="alternate"/>
  <updated>2025-07-14T10:00:00Z</updated>
  <entry>
    <title>Entry One</title>
    <link href="https://example.com/e1" rel="alternate"/>
    <id>urn:uuid:11111111-1111-1111-1111-111111111111</id>
    <updated>2025-07-13T12:00:00Z</updated>
    <published>2025-07-13T09:00:00Z</published>
    <summary>Atom summary</summary>
    <content type="html">&lt;p&gt;Atom body&lt;/p&gt;</content>
    <author>
      <name>Bob Author</name>
    </author>
    <category term="Models"/>
    <category term="Research"/>
  </entry>
</feed>`;

describe("parseFeed", () => {
  it("parses a valid RSS 2.0 feed", () => {
    const feed = parseFeed(RSS_VALID);

    expect(feed.format).toBe("rss");
    expect(feed.title).toBe("Radar Feed");
    expect(feed.description).toBe("Veille IA");
    expect(feed.link).toBe("https://example.com/");
    expect(feed.language).toBe("fr-FR");
    expect(feed.updatedAt?.toISOString()).toBe("2025-07-14T10:00:00.000Z");
    expect(feed.items).toHaveLength(2);

    const first = feed.items[0];
    expect(first.title).toBe("Article One");
    expect(first.link).toBe("https://example.com/a1");
    expect(first.id).toBe("https://example.com/a1");
    expect(first.summary).toBe("Summary one");
    expect(first.author).toBe("alice@example.com");
    expect(first.publishedAt?.toISOString()).toBe("2025-07-13T09:00:00.000Z");
    expect(first.categories).toEqual(["AI", "ML"]);
    expect(first.content).toBe("<p>Full body</p>");
  });

  it("parses a valid Atom 1.0 feed", () => {
    const feed = parseFeed(ATOM_VALID);

    expect(feed.format).toBe("atom");
    expect(feed.title).toBe("Atom Radar");
    expect(feed.description).toBe("Atom subtitle");
    expect(feed.link).toBe("https://example.com/");
    expect(feed.language).toBe("en");
    expect(feed.updatedAt?.toISOString()).toBe("2025-07-14T10:00:00.000Z");
    expect(feed.items).toHaveLength(1);

    const entry = feed.items[0];
    expect(entry.title).toBe("Entry One");
    expect(entry.link).toBe("https://example.com/e1");
    expect(entry.id).toBe("urn:uuid:11111111-1111-1111-1111-111111111111");
    expect(entry.summary).toBe("Atom summary");
    expect(entry.author).toBe("Bob Author");
    expect(entry.publishedAt?.toISOString()).toBe("2025-07-13T09:00:00.000Z");
    expect(entry.categories).toEqual(["Models", "Research"]);
    expect(entry.content).toBe("<p>Atom body</p>");
  });

  it("parses an empty RSS channel with no items", () => {
    const feed = parseFeed(`<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Empty</title>
          <link>https://example.com/</link>
          <description>None</description>
        </channel>
      </rss>`);

    expect(feed.format).toBe("rss");
    expect(feed.title).toBe("Empty");
    expect(feed.items).toEqual([]);
  });

  it("parses an empty Atom feed with no entries", () => {
    const feed = parseFeed(`<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Empty Atom</title>
        <updated>2025-07-14T10:00:00Z</updated>
      </feed>`);

    expect(feed.format).toBe("atom");
    expect(feed.items).toEqual([]);
  });

  it("rejects invalid XML with InvalidXmlError", () => {
    expect(() => parseFeed("<rss><channel></rss>")).toThrow(InvalidXmlError);
  });

  it("rejects unrecognized formats with UnrecognizedFeedFormatError", () => {
    expect(() => parseFeed("<html><body>not a feed</body></html>")).toThrow(
      UnrecognizedFeedFormatError,
    );
  });

  it("tolerates missing optional feed and item fields", () => {
    const feed = parseFeed(`<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <item>
            <title>Sparse</title>
          </item>
        </channel>
      </rss>`);

    expect(feed.title).toBeNull();
    expect(feed.description).toBeNull();
    expect(feed.link).toBeNull();
    expect(feed.language).toBeNull();
    expect(feed.updatedAt).toBeNull();

    const item = feed.items[0];
    expect(item.title).toBe("Sparse");
    expect(item.link).toBeNull();
    expect(item.id).toBeNull();
    expect(item.summary).toBeNull();
    expect(item.author).toBeNull();
    expect(item.publishedAt).toBeNull();
    expect(item.categories).toEqual([]);
    expect(item.content).toBeNull();
  });

  it("collects multiple categories on RSS items", () => {
    const feed = parseFeed(`<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Cats</title>
          <item>
            <title>Multi</title>
            <category>One</category>
            <category>Two</category>
            <category>Three</category>
          </item>
        </channel>
      </rss>`);

    expect(feed.items[0].categories).toEqual(["One", "Two", "Three"]);
  });

  it("allows missing guid on RSS items", () => {
    const feed = parseFeed(`<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>No guid</title>
          <item>
            <title>Item</title>
            <link>https://example.com/x</link>
          </item>
        </channel>
      </rss>`);

    expect(feed.items[0].id).toBeNull();
    expect(feed.items[0].link).toBe("https://example.com/x");
  });

  it("allows missing author on RSS and Atom items", () => {
    const rss = parseFeed(`<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>No author</title>
          <item><title>R</title></item>
        </channel>
      </rss>`);
    const atom = parseFeed(`<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>No author</title>
        <entry><title>A</title><id>urn:1</id></entry>
      </feed>`);

    expect(rss.items[0].author).toBeNull();
    expect(atom.items[0].author).toBeNull();
  });

  it("allows missing dates on feed and items", () => {
    const feed = parseFeed(`<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>No dates</title>
          <item>
            <title>Item</title>
          </item>
        </channel>
      </rss>`);

    expect(feed.updatedAt).toBeNull();
    expect(feed.items[0].publishedAt).toBeNull();
  });

  it("accepts Uint8Array UTF-8 input", () => {
    const bytes = new TextEncoder().encode(RSS_VALID);
    const feed = parseFeed(bytes);
    expect(feed.title).toBe("Radar Feed");
  });

  it("ignores unknown fields without failing", () => {
    const feed = parseFeed(`<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Extra</title>
          <generator>custom-bot</generator>
          <customVendorField>ignored</customVendorField>
          <item>
            <title>Item</title>
            <source url="https://example.com">Origin</source>
            <weird:extension xmlns:weird="urn:x">x</weird:extension>
          </item>
        </channel>
      </rss>`);

    expect(feed.title).toBe("Extra");
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].title).toBe("Item");
  });

  it("does not resolve external XML entities (XXE)", () => {
    const xml = `<?xml version="1.0"?>
      <!DOCTYPE feed [
        <!ENTITY xxe SYSTEM "file:///etc/passwd">
      ]>
      <rss version="2.0">
        <channel>
          <title>&xxe;</title>
          <link>https://example.com/</link>
          <description>safe</description>
        </channel>
      </rss>`;

    // Either reject malformed/unsafe entity expansion or leave the entity unresolved.
    // Never surface filesystem contents.
    try {
      const feed = parseFeed(xml);
      expect(feed.title).not.toMatch(/root:|passwd/i);
      expect(feed.title === null || !feed.title.includes(":")).toBe(true);
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidXmlError);
    }
  });
});
