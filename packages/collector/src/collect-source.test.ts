import { describe, expect, it, vi } from "vitest";

import {
  NetworkError,
  SourceEmptyBodyError,
  SourceFeedParseError,
  SourceHttpStatusError,
  SsrfBlockedError,
  TimeoutError,
  createIncrementalCollector,
  type ParseFeedFn,
  type SecureHttpClient,
  type SecureHttpGetOptions,
  type SecureHttpResponse,
  type SourceDefinition,
  type SourceFetchState,
} from "./index.js";

const SOURCE: SourceDefinition = {
  id: "example-feed",
  name: "Example Feed",
  url: "https://example.com/feed.xml",
  tier: "S",
  enabled: true,
  provider: "rss",
};

const RSS_VALID = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Radar Feed</title>
    <link>https://example.com/</link>
    <description>Veille IA</description>
    <item>
      <title>Article One</title>
      <link>https://example.com/a1</link>
      <guid>https://example.com/a1</guid>
    </item>
  </channel>
</rss>`;

const ATOM_VALID = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Radar</title>
  <link href="https://example.com/" rel="alternate"/>
  <updated>2025-07-14T10:00:00Z</updated>
  <entry>
    <title>Entry One</title>
    <link href="https://example.com/e1" rel="alternate"/>
    <id>urn:uuid:11111111-1111-1111-1111-111111111111</id>
    <updated>2025-07-13T12:00:00Z</updated>
  </entry>
</feed>`;

function bodyBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function mockResponse(
  init: {
    status: number;
    statusText?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
    url?: string;
  },
): SecureHttpResponse {
  const body =
    init.body === undefined
      ? new Uint8Array(0)
      : typeof init.body === "string"
        ? bodyBytes(init.body)
        : init.body;

  return {
    status: init.status,
    statusText: init.statusText ?? "",
    headers: new Headers(init.headers),
    body,
    url: init.url ?? SOURCE.url,
  };
}

function createMockClient(
  handler: (
    url: string | URL,
    options?: SecureHttpGetOptions,
  ) => Promise<SecureHttpResponse> | SecureHttpResponse,
): SecureHttpClient {
  return {
    get: vi.fn(async (url, options) => handler(url, options)),
  };
}

describe("createIncrementalCollector", () => {
  it("collects initially without prior state", async () => {
    const client = createMockClient(() =>
      mockResponse({
        status: 200,
        headers: { ETag: '"v1"', "Last-Modified": "Mon, 14 Jul 2025 10:00:00 GMT" },
        body: RSS_VALID,
      }),
    );
    const collector = createIncrementalCollector({ httpClient: client });

    const result = await collector.collect(SOURCE);

    expect(result.status).toBe("updated");
    if (result.status !== "updated") {
      return;
    }
    expect(result.httpStatus).toBe(200);
    expect(result.source).toEqual(SOURCE);
    expect(result.state).toEqual({
      etag: '"v1"',
      lastModified: "Mon, 14 Jul 2025 10:00:00 GMT",
    });
    expect(result.feed.format).toBe("rss");
    expect(client.get).toHaveBeenCalledOnce();
    expect(client.get).toHaveBeenCalledWith(SOURCE.url, undefined);
  });

  it("sends If-None-Match when an ETag is present", async () => {
    const client = createMockClient((_url, options) => {
      const headers = new Headers(options?.headers);
      expect(headers.get("If-None-Match")).toBe('"abc"');
      expect(headers.has("If-Modified-Since")).toBe(false);
      return mockResponse({ status: 304 });
    });
    const collector = createIncrementalCollector({ httpClient: client });

    await collector.collect(SOURCE, { etag: '"abc"' });
    expect(client.get).toHaveBeenCalledOnce();
  });

  it("sends If-Modified-Since when Last-Modified is present", async () => {
    const lastModified = "Mon, 14 Jul 2025 10:00:00 GMT";
    const client = createMockClient((_url, options) => {
      const headers = new Headers(options?.headers);
      expect(headers.get("If-Modified-Since")).toBe(lastModified);
      expect(headers.has("If-None-Match")).toBe(false);
      return mockResponse({ status: 304 });
    });
    const collector = createIncrementalCollector({ httpClient: client });

    await collector.collect(SOURCE, { lastModified });
    expect(client.get).toHaveBeenCalledOnce();
  });

  it("sends both conditional validators together", async () => {
    const client = createMockClient((_url, options) => {
      const headers = new Headers(options?.headers);
      expect(headers.get("If-None-Match")).toBe('"both"');
      expect(headers.get("If-Modified-Since")).toBe(
        "Tue, 15 Jul 2025 08:00:00 GMT",
      );
      return mockResponse({ status: 304 });
    });
    const collector = createIncrementalCollector({ httpClient: client });

    await collector.collect(SOURCE, {
      etag: '"both"',
      lastModified: "Tue, 15 Jul 2025 08:00:00 GMT",
    });
    expect(client.get).toHaveBeenCalledOnce();
  });

  it("reads conditional headers case-insensitively via Headers", async () => {
    const client = createMockClient((_url, options) => {
      const headers = new Headers(options?.headers);
      expect(headers.get("if-none-match")).toBe('"case"');
      expect(headers.get("IF-MODIFIED-SINCE")).toBe(
        "Wed, 16 Jul 2025 09:00:00 GMT",
      );
      return mockResponse({ status: 304 });
    });
    const collector = createIncrementalCollector({ httpClient: client });

    await collector.collect(SOURCE, {
      etag: '"case"',
      lastModified: "Wed, 16 Jul 2025 09:00:00 GMT",
    });
  });

  it("does not send empty conditional headers", async () => {
    const client = createMockClient((_url, options) => {
      expect(options).toBeUndefined();
      return mockResponse({ status: 200, body: RSS_VALID });
    });
    const collector = createIncrementalCollector({ httpClient: client });

    await collector.collect(SOURCE, { etag: "   ", lastModified: "" });
    expect(client.get).toHaveBeenCalledWith(SOURCE.url, undefined);
  });

  it("returns not-modified on 304 without calling parseFeed", async () => {
    const parseFeed = vi.fn<ParseFeedFn>();
    const client = createMockClient(() => mockResponse({ status: 304 }));
    const collector = createIncrementalCollector({
      httpClient: client,
      parseFeed,
    });

    const previous: SourceFetchState = {
      etag: '"keep"',
      lastModified: "Mon, 14 Jul 2025 10:00:00 GMT",
    };
    const result = await collector.collect(SOURCE, previous);

    expect(result.status).toBe("not-modified");
    if (result.status !== "not-modified") {
      return;
    }
    expect(result.httpStatus).toBe(304);
    expect(result.source).toEqual(SOURCE);
    expect(result.state).toEqual(previous);
    expect(parseFeed).not.toHaveBeenCalled();
  });

  it("keeps previous state on 304 when response has no validators", async () => {
    const client = createMockClient(() =>
      mockResponse({ status: 304, headers: {} }),
    );
    const collector = createIncrementalCollector({ httpClient: client });
    const previous: SourceFetchState = {
      etag: '"old"',
      lastModified: "Mon, 14 Jul 2025 10:00:00 GMT",
    };

    const result = await collector.collect(SOURCE, previous);

    expect(result.status).toBe("not-modified");
    if (result.status !== "not-modified") {
      return;
    }
    expect(result.state).toEqual(previous);
  });

  it("partially updates state on 304 when only one validator is returned", async () => {
    const client = createMockClient(() =>
      mockResponse({
        status: 304,
        headers: { ETag: '"fresh"' },
      }),
    );
    const collector = createIncrementalCollector({ httpClient: client });

    const result = await collector.collect(SOURCE, {
      etag: '"stale"',
      lastModified: "Mon, 14 Jul 2025 10:00:00 GMT",
    });

    expect(result.status).toBe("not-modified");
    if (result.status !== "not-modified") {
      return;
    }
    expect(result.state).toEqual({
      etag: '"fresh"',
      lastModified: "Mon, 14 Jul 2025 10:00:00 GMT",
    });
  });

  it("parses a valid RSS body on 200", async () => {
    const client = createMockClient(() =>
      mockResponse({
        status: 200,
        headers: { ETag: '"rss1"' },
        body: RSS_VALID,
      }),
    );
    const collector = createIncrementalCollector({ httpClient: client });

    const result = await collector.collect(SOURCE);

    expect(result.status).toBe("updated");
    if (result.status !== "updated") {
      return;
    }
    expect(result.feed.format).toBe("rss");
    expect(result.feed.title).toBe("Radar Feed");
    expect(result.feed.items).toHaveLength(1);
    expect(result.state.etag).toBe('"rss1"');
  });

  it("parses a valid Atom body on 200", async () => {
    const atomSource: SourceDefinition = {
      ...SOURCE,
      provider: "atom",
    };
    const client = createMockClient(() =>
      mockResponse({
        status: 200,
        headers: {
          ETag: '"atom1"',
          "Last-Modified": "Mon, 14 Jul 2025 10:00:00 GMT",
        },
        body: ATOM_VALID,
      }),
    );
    const collector = createIncrementalCollector({ httpClient: client });

    const result = await collector.collect(atomSource);

    expect(result.status).toBe("updated");
    if (result.status !== "updated") {
      return;
    }
    expect(result.feed.format).toBe("atom");
    expect(result.feed.title).toBe("Atom Radar");
    expect(result.state).toEqual({
      etag: '"atom1"',
      lastModified: "Mon, 14 Jul 2025 10:00:00 GMT",
    });
  });

  it("rejects Atom body when provider is rss", async () => {
    const client = createMockClient(() =>
      mockResponse({ status: 200, body: ATOM_VALID }),
    );
    const collector = createIncrementalCollector({ httpClient: client });

    await expect(collector.collect(SOURCE)).rejects.toBeInstanceOf(
      SourceFeedParseError,
    );
  });

  it("refuses disabled html provider", async () => {
    const htmlSource: SourceDefinition = {
      ...SOURCE,
      id: "html-stub",
      provider: "html",
      enabled: false,
    };
    const client = createMockClient(() =>
      mockResponse({ status: 200, body: "<html></html>" }),
    );
    const collector = createIncrementalCollector({ httpClient: client });

    await expect(collector.collect(htmlSource)).rejects.toThrow(/disabled/i);
  });

  it("reads a new ETag and Last-Modified from a 2xx response", async () => {
    const client = createMockClient(() =>
      mockResponse({
        status: 200,
        headers: {
          etag: 'W/"weak-1"',
          "last-modified": "Thu, 17 Jul 2025 12:00:00 GMT",
        },
        body: RSS_VALID,
      }),
    );
    const collector = createIncrementalCollector({ httpClient: client });

    const result = await collector.collect(SOURCE, {
      etag: '"old-etag"',
      lastModified: "Mon, 14 Jul 2025 10:00:00 GMT",
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") {
      return;
    }
    expect(result.state.etag).toBe('W/"weak-1"');
    expect(result.state.lastModified).toBe("Thu, 17 Jul 2025 12:00:00 GMT");
  });

  it("replaces a previous ETag and Last-Modified on update", async () => {
    const client = createMockClient(() =>
      mockResponse({
        status: 200,
        headers: {
          ETag: '"new"',
          "Last-Modified": "Fri, 18 Jul 2025 01:00:00 GMT",
        },
        body: RSS_VALID,
      }),
    );
    const collector = createIncrementalCollector({ httpClient: client });

    const result = await collector.collect(SOURCE, {
      etag: '"previous"',
      lastModified: "Mon, 14 Jul 2025 10:00:00 GMT",
    });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") {
      return;
    }
    expect(result.state).toEqual({
      etag: '"new"',
      lastModified: "Fri, 18 Jul 2025 01:00:00 GMT",
    });
  });

  it("preserves the exact form of a weak ETag", async () => {
    const weak = 'W/"abc123"';
    const client = createMockClient(() =>
      mockResponse({
        status: 200,
        headers: { ETag: weak },
        body: RSS_VALID,
      }),
    );
    const collector = createIncrementalCollector({ httpClient: client });

    const result = await collector.collect(SOURCE);

    expect(result.status).toBe("updated");
    if (result.status !== "updated") {
      return;
    }
    expect(result.state.etag).toBe(weak);
  });

  it("allows a 2xx response without cache validators", async () => {
    const client = createMockClient(() =>
      mockResponse({ status: 200, body: RSS_VALID }),
    );
    const collector = createIncrementalCollector({ httpClient: client });

    const result = await collector.collect(SOURCE, { etag: '"keep-me"' });

    expect(result.status).toBe("updated");
    if (result.status !== "updated") {
      return;
    }
    expect(result.state).toEqual({ etag: '"keep-me"' });
  });

  it("rejects an empty 2xx body", async () => {
    const client = createMockClient(() =>
      mockResponse({ status: 200, body: new Uint8Array(0) }),
    );
    const collector = createIncrementalCollector({ httpClient: client });

    await expect(collector.collect(SOURCE)).rejects.toMatchObject({
      name: "SourceEmptyBodyError",
      sourceId: SOURCE.id,
      sourceUrl: SOURCE.url,
    });
    await expect(collector.collect(SOURCE)).rejects.toBeInstanceOf(
      SourceEmptyBodyError,
    );
  });

  it("wraps invalid XML with SourceFeedParseError and preserves cause", async () => {
    const client = createMockClient(() =>
      mockResponse({ status: 200, body: "<not-xml" }),
    );
    const collector = createIncrementalCollector({ httpClient: client });

    try {
      await collector.collect(SOURCE);
      expect.unreachable("expected parse error");
    } catch (error) {
      expect(error).toBeInstanceOf(SourceFeedParseError);
      const typed = error as SourceFeedParseError;
      expect(typed.sourceId).toBe(SOURCE.id);
      expect(typed.sourceUrl).toBe(SOURCE.url);
      expect(typed.cause).toBeInstanceOf(Error);
      expect(typed.message).not.toContain("<not-xml");
    }
  });

  it("wraps unrecognized feeds with SourceFeedParseError", async () => {
    const client = createMockClient(() =>
      mockResponse({
        status: 200,
        body: '<?xml version="1.0"?><note><to>Alice</to></note>',
      }),
    );
    const collector = createIncrementalCollector({ httpClient: client });

    await expect(collector.collect(SOURCE)).rejects.toBeInstanceOf(
      SourceFeedParseError,
    );
  });

  it("rejects HTTP 404 with SourceHttpStatusError", async () => {
    const client = createMockClient(() =>
      mockResponse({ status: 404, body: "not found secret-body" }),
    );
    const collector = createIncrementalCollector({ httpClient: client });

    try {
      await collector.collect(SOURCE);
      expect.unreachable("expected status error");
    } catch (error) {
      expect(error).toBeInstanceOf(SourceHttpStatusError);
      const typed = error as SourceHttpStatusError;
      expect(typed.httpStatus).toBe(404);
      expect(typed.sourceId).toBe(SOURCE.id);
      expect(typed.sourceUrl).toBe(SOURCE.url);
      expect(typed.message).not.toContain("secret-body");
      expect(JSON.stringify(typed)).not.toContain("secret-body");
    }
  });

  it("rejects HTTP 429 with SourceHttpStatusError", async () => {
    const client = createMockClient(() => mockResponse({ status: 429 }));
    const collector = createIncrementalCollector({ httpClient: client });

    await expect(collector.collect(SOURCE)).rejects.toMatchObject({
      name: "SourceHttpStatusError",
      httpStatus: 429,
      sourceId: SOURCE.id,
    });
  });

  it("rejects HTTP 500 with SourceHttpStatusError", async () => {
    const client = createMockClient(() => mockResponse({ status: 500 }));
    const collector = createIncrementalCollector({ httpClient: client });

    await expect(collector.collect(SOURCE)).rejects.toMatchObject({
      name: "SourceHttpStatusError",
      httpStatus: 500,
    });
  });

  it("propagates network errors without wrapping", async () => {
    const networkError = new NetworkError();
    const client = createMockClient(async () => {
      throw networkError;
    });
    const collector = createIncrementalCollector({ httpClient: client });

    await expect(collector.collect(SOURCE)).rejects.toBe(networkError);
  });

  it("propagates timeout errors without wrapping", async () => {
    const timeoutError = new TimeoutError();
    const client = createMockClient(async () => {
      throw timeoutError;
    });
    const collector = createIncrementalCollector({ httpClient: client });

    await expect(collector.collect(SOURCE)).rejects.toBe(timeoutError);
  });

  it("propagates SSRF errors without wrapping", async () => {
    const ssrfError = new SsrfBlockedError();
    const client = createMockClient(async () => {
      throw ssrfError;
    });
    const collector = createIncrementalCollector({ httpClient: client });

    await expect(collector.collect(SOURCE)).rejects.toBe(ssrfError);
  });

  it("includes the source in updated and not-modified results", async () => {
    const updatedClient = createMockClient(() =>
      mockResponse({ status: 200, body: RSS_VALID }),
    );
    const notModifiedClient = createMockClient(() =>
      mockResponse({ status: 304 }),
    );

    const updated = await createIncrementalCollector({
      httpClient: updatedClient,
    }).collect(SOURCE);
    const notModified = await createIncrementalCollector({
      httpClient: notModifiedClient,
    }).collect(SOURCE, { etag: '"x"' });

    expect(updated.source).toBe(SOURCE);
    expect(notModified.source).toBe(SOURCE);
  });

  it("does not mutate the input state object", async () => {
    const previous: SourceFetchState = {
      etag: '"immutable"',
      lastModified: "Mon, 14 Jul 2025 10:00:00 GMT",
    };
    const snapshot = structuredClone(previous);
    const client = createMockClient(() =>
      mockResponse({
        status: 200,
        headers: { ETag: '"next"' },
        body: RSS_VALID,
      }),
    );
    const collector = createIncrementalCollector({ httpClient: client });

    const result = await collector.collect(SOURCE, previous);

    expect(previous).toEqual(snapshot);
    expect(result.state).not.toBe(previous);
    expect(result.state.etag).toBe('"next"');
  });

  it("returns a typed updated result", async () => {
    const client = createMockClient(() =>
      mockResponse({ status: 200, body: RSS_VALID }),
    );
    const collector = createIncrementalCollector({ httpClient: client });

    const result = await collector.collect(SOURCE);

    expect(result.status).toBe("updated");
    if (result.status === "updated") {
      expect(result.feed).toBeDefined();
      expect(result.httpStatus).toBe(200);
      expect("feed" in result).toBe(true);
    }
  });

  it("returns a typed not-modified result", async () => {
    const client = createMockClient(() => mockResponse({ status: 304 }));
    const collector = createIncrementalCollector({ httpClient: client });

    const result = await collector.collect(SOURCE, { etag: '"x"' });

    expect(result.status).toBe("not-modified");
    if (result.status === "not-modified") {
      expect(result.httpStatus).toBe(304);
      expect("feed" in result).toBe(false);
    }
  });

  it("never issues a real network request in these tests", async () => {
    const client = createMockClient(() =>
      mockResponse({ status: 200, body: RSS_VALID }),
    );
    const collector = createIncrementalCollector({ httpClient: client });

    await collector.collect(SOURCE);

    expect(vi.isMockFunction(client.get)).toBe(true);
    expect(client.get).toHaveBeenCalledOnce();
  });
});
