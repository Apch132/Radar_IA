import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_USER_AGENT,
  NULL_BODY_STATUS_CODES,
  buildWebResponse,
  createSecureHttpClient,
  InvalidUrlError,
  NetworkError,
  RedirectError,
  ResponseTooLargeError,
  SsrfBlockedError,
  TimeoutError,
  type FetchLike,
} from "./index.js";

function textResponse(
  body: string,
  init: {
    status?: number;
    statusText?: string;
    headers?: Record<string, string>;
    url?: string;
  } = {},
): Response {
  return new Response(body, {
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    headers: init.headers,
  });
}

function publicLookup(hostname: string): Promise<readonly string[]> {
  if (hostname === "example.com" || hostname === "feeds.example.com") {
    return Promise.resolve(["93.184.216.34"]);
  }
  if (hostname === "cdn.example.net") {
    return Promise.resolve(["151.101.1.69"]);
  }
  return Promise.resolve(["93.184.216.34"]);
}

describe("createSecureHttpClient", () => {
  it("performs a valid HTTPS request", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      textResponse("<rss/>", { status: 200 }),
    );
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
    });

    const response = await client.get("https://example.com/feed.xml");

    expect(response.status).toBe(200);
    expect(new TextDecoder().decode(response.body)).toBe("<rss/>");
    expect(response.url).toBe("https://example.com/feed.xml");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("performs a valid HTTP request", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      textResponse("<feed/>", { status: 200 }),
    );
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
    });

    const response = await client.get("http://example.com/atom.xml");

    expect(response.status).toBe(200);
    expect(new TextDecoder().decode(response.body)).toBe("<feed/>");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("always sends the centralized User-Agent", async () => {
    const fetchMock = vi.fn<FetchLike>(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("User-Agent")).toBe(DEFAULT_USER_AGENT);
      return textResponse("ok");
    });
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
    });

    await client.get("https://example.com/feed");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("keeps consumer headers while forcing User-Agent", async () => {
    const fetchMock = vi.fn<FetchLike>(async (_url, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("Accept")).toBe("application/rss+xml");
      expect(headers.get("User-Agent")).toBe(DEFAULT_USER_AGENT);
      return textResponse("ok");
    });
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
    });

    await client.get("https://example.com/feed", {
      headers: {
        Accept: "application/rss+xml",
        "User-Agent": "EvilAgent/1.0",
      },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects an invalid URL", async () => {
    const fetchMock = vi.fn<FetchLike>();
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
    });

    await expect(client.get("not a url")).rejects.toBeInstanceOf(InvalidUrlError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects disallowed protocols", async () => {
    const fetchMock = vi.fn<FetchLike>();
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
    });

    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/file",
      "data:text/plain,hi",
      "javascript:alert(1)",
      "ws://example.com/",
      "wss://example.com/",
    ]) {
      await expect(client.get(url)).rejects.toBeInstanceOf(InvalidUrlError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects localhost hostnames", async () => {
    const fetchMock = vi.fn<FetchLike>();
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
    });

    await expect(client.get("http://localhost/feed")).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    await expect(
      client.get("http://app.localhost/feed"),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    await expect(client.get("http://printer.local/feed")).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects IPv4 loopback addresses", async () => {
    const fetchMock = vi.fn<FetchLike>();
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
    });

    await expect(client.get("http://127.0.0.1/feed")).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    await expect(client.get("http://127.1.2.3/feed")).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects primary private IPv4 ranges", async () => {
    const fetchMock = vi.fn<FetchLike>();
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
    });

    for (const url of [
      "http://10.0.0.8/feed",
      "http://172.16.5.1/feed",
      "http://172.31.255.1/feed",
      "http://192.168.1.20/feed",
      "http://169.254.169.254/latest/meta-data",
      "http://0.0.0.0/feed",
    ]) {
      await expect(client.get(url)).rejects.toBeInstanceOf(SsrfBlockedError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects IPv6 loopback", async () => {
    const fetchMock = vi.fn<FetchLike>();
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
    });

    await expect(client.get("http://[::1]/feed")).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects private and link-local IPv6 addresses", async () => {
    const fetchMock = vi.fn<FetchLike>();
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
    });

    for (const url of [
      "http://[fc00::1]/feed",
      "http://[fd12:3456:789a::1]/feed",
      "http://[fe80::1]/feed",
      "http://[::]/feed",
      "http://[::ffff:127.0.0.1]/feed",
      "http://[::ffff:192.168.0.1]/feed",
    ]) {
      await expect(client.get(url)).rejects.toBeInstanceOf(SsrfBlockedError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when DNS resolves to a private address", async () => {
    const fetchMock = vi.fn<FetchLike>();
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: async () => ["10.1.2.3"],
    });

    await expect(
      client.get("https://internal.example.com/feed"),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects when any resolved DNS address is forbidden", async () => {
    const fetchMock = vi.fn<FetchLike>();
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: async () => ["93.184.216.34", "192.168.0.10"],
    });

    await expect(client.get("https://dual.example.com/feed")).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call fetch after an SSRF validation failure", async () => {
    const fetchMock = vi.fn<FetchLike>();
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: async () => ["127.0.0.1"],
    });

    await expect(client.get("https://evil.example.com/x")).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes timeouts", async () => {
    const fetchMock = vi.fn<FetchLike>(async (_url, init) => {
      const signal = init?.signal;
      expect(signal).toBeDefined();
      return await new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          const abortError = new Error("Aborted");
          abortError.name = "AbortError";
          reject(abortError);
        });
      });
    });
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
      timeoutMs: 20,
    });

    await expect(client.get("https://example.com/slow")).rejects.toBeInstanceOf(
      TimeoutError,
    );
  });

  it("normalizes network errors", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => {
      throw new TypeError("fetch failed");
    });
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
    });

    await expect(client.get("https://example.com/down")).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it("returns non-2xx HTTP responses without converting them to network errors", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      textResponse("missing", { status: 404, statusText: "Not Found" }),
    );
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
    });

    const response = await client.get("https://example.com/missing");
    expect(response.status).toBe(404);
    expect(new TextDecoder().decode(response.body)).toBe("missing");
  });

  it("follows a valid public redirect", async () => {
    const fetchMock = vi.fn<FetchLike>(async (input) => {
      const url = String(input);
      if (url === "https://example.com/old") {
        return textResponse("", {
          status: 302,
          headers: { Location: "https://cdn.example.net/new.xml" },
        });
      }
      return textResponse("<rss/>", { status: 200 });
    });
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
    });

    const response = await client.get("https://example.com/old");
    expect(response.status).toBe(200);
    expect(response.url).toBe("https://cdn.example.net/new.xml");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a redirect toward a private destination", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      textResponse("", {
        status: 302,
        headers: { Location: "http://127.0.0.1/secret" },
      }),
    );
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
    });

    await expect(client.get("https://example.com/start")).rejects.toBeInstanceOf(
      SsrfBlockedError,
    );
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("rejects when the redirect limit is exceeded", async () => {
    const fetchMock = vi.fn<FetchLike>(async (input) => {
      const url = new URL(String(input));
      const hop = Number(url.searchParams.get("h") ?? "0");
      return textResponse("", {
        status: 302,
        headers: {
          Location: `https://example.com/r?h=${String(hop + 1)}`,
        },
      });
    });
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
      maxRedirects: 2,
    });

    await expect(client.get("https://example.com/r?h=0")).rejects.toBeInstanceOf(
      RedirectError,
    );
  });

  it("rejects a redirect without a usable Location header", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      textResponse("", { status: 302 }),
    );
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
    });

    await expect(client.get("https://example.com/nolocation")).rejects.toBeInstanceOf(
      RedirectError,
    );
  });

  it("accepts a body below the size limit", async () => {
    const body = "a".repeat(1024);
    const fetchMock = vi.fn<FetchLike>(async () => textResponse(body));
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
      maxBodyBytes: 2048,
    });

    const response = await client.get("https://example.com/small");
    expect(response.body.byteLength).toBe(1024);
  });

  it("rejects a body that exceeds the size limit", async () => {
    const body = "b".repeat(4096);
    const fetchMock = vi.fn<FetchLike>(async () => textResponse(body));
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
      maxBodyBytes: 1024,
    });

    await expect(client.get("https://example.com/huge")).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
  });

  it("rejects oversized Content-Length without retaining the body", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      textResponse("secret-payload", {
        headers: { "content-length": "999999" },
      }),
    );
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
      maxBodyBytes: 100,
    });

    await expect(client.get("https://example.com/cl")).rejects.toBeInstanceOf(
      ResponseTooLargeError,
    );
  });

  it("does not leak sensitive values in error messages", async () => {
    const secret = "super-secret-token-value-XYZ";
    const fetchMock = vi.fn<FetchLike>();
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: async () => {
        throw new Error(`resolver failed for token=${secret}`);
      },
    });

    try {
      await client.get("https://example.com/feed");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SsrfBlockedError);
      const message = String(error);
      expect(message).not.toContain(secret);
      expect(message).toContain("Request blocked");
    }
  });
});

describe("buildWebResponse (null-body statuses)", () => {
  it("constructs 304 with a null body without throwing", () => {
    const response = buildWebResponse(
      304,
      "Not Modified",
      new Headers({ etag: '"abc"' }),
      Buffer.from("should-be-ignored"),
    );
    expect(response.status).toBe(304);
    expect(response.body).toBeNull();
  });

  it("documents that undici rejects a non-null body for status 304", () => {
    expect(() => new Response(Buffer.from("x"), { status: 304 })).toThrow(
      /Invalid response status code 304/i,
    );
  });

  it("constructs other null-body statuses with null body", () => {
    for (const status of NULL_BODY_STATUS_CODES) {
      const response = buildWebResponse(
        status,
        "null-body",
        new Headers(),
        Buffer.from("payload"),
      );
      expect(response.status).toBe(status);
      expect(response.body).toBeNull();
    }
  });

  it("keeps bodies for normal success responses", async () => {
    const response = buildWebResponse(
      200,
      "OK",
      new Headers({ "content-type": "application/rss+xml" }),
      Buffer.from("<rss/>"),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<rss/>");
  });

  it("secure client treats buildWebResponse(304) as empty body (notModified path)", async () => {
    const fetchMock = vi.fn<FetchLike>(async () =>
      buildWebResponse(
        304,
        "Not Modified",
        new Headers({ etag: '"feed-v1"' }),
        Buffer.from("ignored-by-null-body-rule"),
      ),
    );
    const client = createSecureHttpClient({
      fetch: fetchMock,
      lookup: publicLookup,
    });

    const response = await client.get("https://example.com/feed.xml");
    expect(response.status).toBe(304);
    expect(response.body.byteLength).toBe(0);
    expect(response.headers.get("etag")).toBe('"feed-v1"');
  });
});
