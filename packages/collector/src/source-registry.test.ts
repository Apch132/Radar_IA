import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  DuplicateSourceIdError,
  DuplicateSourceUrlError,
  InvalidSourceRegistryError,
  SOURCE_TIERS,
  getEnabledSources,
  loadSourceRegistry,
  parseSourceRegistry,
} from "./index.js";

const VALID_SOURCE = {
  id: "openai-news",
  name: "OpenAI News",
  url: "https://openai.com/news/rss.xml",
  tier: "S" as const,
  enabled: true,
  provider: "rss" as const,
};

function registryJson(sources: unknown[]): string {
  return JSON.stringify({ sources });
}

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

async function writeTempRegistry(contents: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "radar-ia-sources-"));
  tempDirs.push(dir);
  const filePath = join(dir, "sources.json");
  await writeFile(filePath, contents, "utf8");
  return filePath;
}

describe("parseSourceRegistry", () => {
  it("accepts a valid registry", () => {
    const registry = parseSourceRegistry(registryJson([VALID_SOURCE]));

    expect(registry.sources).toHaveLength(1);
    expect(registry.sources[0]).toEqual(VALID_SOURCE);
  });

  it("accepts a valid string input", () => {
    const registry = parseSourceRegistry(registryJson([VALID_SOURCE]));
    expect(registry.sources[0]?.id).toBe("openai-news");
  });

  it("accepts a valid Uint8Array input", () => {
    const bytes = new TextEncoder().encode(registryJson([VALID_SOURCE]));
    const registry = parseSourceRegistry(bytes);
    expect(registry.sources[0]?.name).toBe("OpenAI News");
  });

  it("rejects invalid JSON", () => {
    expect(() => parseSourceRegistry("{not json")).toThrow(InvalidSourceRegistryError);
    expect(() => parseSourceRegistry("{not json")).toThrow(/Invalid JSON/);
  });

  it("rejects a non-object root", () => {
    expect(() => parseSourceRegistry("[]")).toThrow(InvalidSourceRegistryError);
    expect(() => parseSourceRegistry('"x"')).toThrow(InvalidSourceRegistryError);
  });

  it("rejects a missing sources property", () => {
    expect(() => parseSourceRegistry("{}")).toThrow(InvalidSourceRegistryError);
    expect(() => parseSourceRegistry("{}")).toThrow(/sources/i);
  });

  it("accepts an empty sources array (bootstrap / staged enablement)", () => {
    const registry = parseSourceRegistry(registryJson([]));
    expect(registry.sources).toEqual([]);
    expect(getEnabledSources(registry)).toEqual([]);
  });

  it("accepts a valid id slug", () => {
    const registry = parseSourceRegistry(
      registryJson([{ ...VALID_SOURCE, id: "anthropic-news" }]),
    );
    expect(registry.sources[0]?.id).toBe("anthropic-news");
  });

  it("rejects an invalid id", () => {
    expect(() =>
      parseSourceRegistry(registryJson([{ ...VALID_SOURCE, id: "OpenAI" }])),
    ).toThrow(InvalidSourceRegistryError);

    expect(() =>
      parseSourceRegistry(registryJson([{ ...VALID_SOURCE, id: "-bad" }])),
    ).toThrow(/id/i);

    expect(() =>
      parseSourceRegistry(registryJson([{ ...VALID_SOURCE, id: "bad-" }])),
    ).toThrow(InvalidSourceRegistryError);
  });

  it("rejects a duplicate id", () => {
    expect(() =>
      parseSourceRegistry(
        registryJson([
          VALID_SOURCE,
          { ...VALID_SOURCE, url: "https://example.com/other.xml" },
        ]),
      ),
    ).toThrow(DuplicateSourceIdError);
  });

  it("rejects an empty name", () => {
    expect(() =>
      parseSourceRegistry(registryJson([{ ...VALID_SOURCE, name: "   " }])),
    ).toThrow(InvalidSourceRegistryError);
    expect(() =>
      parseSourceRegistry(registryJson([{ ...VALID_SOURCE, name: "   " }])),
    ).toThrow(/name/i);
  });

  it("accepts a valid HTTPS URL", () => {
    const registry = parseSourceRegistry(registryJson([VALID_SOURCE]));
    expect(registry.sources[0]?.url).toBe("https://openai.com/news/rss.xml");
  });

  it("accepts a valid HTTP URL", () => {
    const registry = parseSourceRegistry(
      registryJson([
        {
          ...VALID_SOURCE,
          url: "http://example.com/feed.xml",
        },
      ]),
    );
    expect(registry.sources[0]?.url).toBe("http://example.com/feed.xml");
  });

  it("rejects a relative URL", () => {
    expect(() =>
      parseSourceRegistry(
        registryJson([{ ...VALID_SOURCE, url: "/feed.xml" }]),
      ),
    ).toThrow(InvalidSourceRegistryError);
  });

  it("rejects a disallowed protocol", () => {
    expect(() =>
      parseSourceRegistry(
        registryJson([{ ...VALID_SOURCE, url: "ftp://example.com/feed.xml" }]),
      ),
    ).toThrow(/protocol/i);
  });

  it("rejects a URL with credentials", () => {
    expect(() =>
      parseSourceRegistry(
        registryJson([
          {
            ...VALID_SOURCE,
            url: "https://user:secret@example.com/feed.xml",
          },
        ]),
      ),
    ).toThrow(InvalidSourceRegistryError);
    expect(() =>
      parseSourceRegistry(
        registryJson([
          {
            ...VALID_SOURCE,
            url: "https://user:secret@example.com/feed.xml",
          },
        ]),
      ),
    ).toThrow(/credentials/i);

    try {
      parseSourceRegistry(
        registryJson([
          {
            ...VALID_SOURCE,
            url: "https://user:secret@example.com/feed.xml",
          },
        ]),
      );
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidSourceRegistryError);
      expect(String(error)).not.toMatch(/secret/i);
    }
  });

  it("rejects a URL with a fragment", () => {
    expect(() =>
      parseSourceRegistry(
        registryJson([
          {
            ...VALID_SOURCE,
            url: "https://example.com/feed.xml#section",
          },
        ]),
      ),
    ).toThrow(/fragment/i);
  });

  it("rejects a duplicate URL (after normalization)", () => {
    expect(() =>
      parseSourceRegistry(
        registryJson([
          VALID_SOURCE,
          {
            ...VALID_SOURCE,
            id: "openai-news-mirror",
            url: "https://OpenAI.com/news/rss.xml/",
          },
        ]),
      ),
    ).toThrow(DuplicateSourceUrlError);
  });

  it("accepts each official tier", () => {
    for (const tier of SOURCE_TIERS) {
      const registry = parseSourceRegistry(
        registryJson([
          {
            ...VALID_SOURCE,
            id: `source-${tier.toLowerCase()}`,
            url: `https://example.com/${tier}.xml`,
            tier,
          },
        ]),
      );
      expect(registry.sources[0]?.tier).toBe(tier);
    }
  });

  it("rejects an unknown tier", () => {
    expect(() =>
      parseSourceRegistry(registryJson([{ ...VALID_SOURCE, tier: "X" }])),
    ).toThrow(InvalidSourceRegistryError);
  });

  it("rejects an invalid enabled value", () => {
    expect(() =>
      parseSourceRegistry(
        registryJson([{ ...VALID_SOURCE, enabled: "yes" }]),
      ),
    ).toThrow(InvalidSourceRegistryError);
  });

  it("rejects unknown properties when validation is strict", () => {
    expect(() =>
      parseSourceRegistry(
        JSON.stringify({
          sources: [{ ...VALID_SOURCE, extra: true }],
        }),
      ),
    ).toThrow(/unknown/i);

    expect(() =>
      parseSourceRegistry(
        JSON.stringify({
          sources: [VALID_SOURCE],
          meta: {},
        }),
      ),
    ).toThrow(/unknown/i);
  });

  it("rejects enabled html/api providers", () => {
    expect(() =>
      parseSourceRegistry(
        registryJson([{ ...VALID_SOURCE, provider: "html", enabled: true }]),
      ),
    ).toThrow(/disabled/i);
    expect(() =>
      parseSourceRegistry(
        registryJson([
          {
            ...VALID_SOURCE,
            id: "api-stub",
            url: "https://example.com/api",
            provider: "api",
            enabled: true,
          },
        ]),
      ),
    ).toThrow(/disabled/i);
  });

  it("accepts disabled html/api provider stubs", () => {
    const registry = parseSourceRegistry(
      registryJson([
        {
          ...VALID_SOURCE,
          id: "html-stub",
          url: "https://example.com/blog",
          provider: "html",
          enabled: false,
        },
      ]),
    );
    expect(registry.sources[0]?.provider).toBe("html");
    expect(registry.sources[0]?.enabled).toBe(false);
  });

  it("requires provider field in strict mode", () => {
    const { provider: _provider, ...withoutProvider } = VALID_SOURCE;
    expect(() =>
      parseSourceRegistry(registryJson([withoutProvider])),
    ).toThrow(InvalidSourceRegistryError);
    expect(() =>
      parseSourceRegistry(registryJson([withoutProvider])),
    ).toThrow(/provider/i);
  });

  it("returns an immutable registry surface", () => {
    const registry = parseSourceRegistry(registryJson([VALID_SOURCE]));
    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.sources)).toBe(true);
    expect(Object.isFrozen(registry.sources[0])).toBe(true);
  });

  it("resilient mode skips a source missing provider and keeps valid peers", () => {
    const { provider: _provider, ...withoutProvider } = VALID_SOURCE;
    const reports: Array<{
      sourceId: string | null;
      provider: string | null;
      reason: string;
      action: string;
    }> = [];

    const registry = parseSourceRegistry(
      registryJson([
        withoutProvider,
        {
          ...VALID_SOURCE,
          id: "anthropic-news",
          url: "https://www.anthropic.com/rss.xml",
        },
      ]),
      {
        mode: "resilient",
        onInvalidSource: (report) => {
          reports.push(report);
        },
      },
    );

    expect(registry.sources.map((s) => s.id)).toEqual(["anthropic-news"]);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.sourceId).toBe("openai-news");
    expect(reports[0]?.provider).toBeNull();
    expect(reports[0]?.action).toBe("disabled");
    expect(reports[0]?.reason).toMatch(/provider/i);
  });

  it("resilient mode does not reject the whole registry for one bad URL", () => {
    const reports: string[] = [];
    const registry = parseSourceRegistry(
      registryJson([
        { ...VALID_SOURCE, url: "ftp://example.com/feed.xml" },
        {
          ...VALID_SOURCE,
          id: "kept-source",
          url: "https://example.com/kept.xml",
        },
      ]),
      {
        mode: "resilient",
        onInvalidSource: (report) => {
          reports.push(report.reason);
        },
      },
    );

    expect(registry.sources).toHaveLength(1);
    expect(registry.sources[0]?.id).toBe("kept-source");
    expect(reports[0]).toMatch(/protocol/i);
  });

  it("strips a UTF-8 BOM from string input", () => {
    const withBom = `\uFEFF${registryJson([VALID_SOURCE])}`;
    const registry = parseSourceRegistry(withBom);
    expect(registry.sources[0]?.id).toBe("openai-news");
  });
});

describe("loadSourceRegistry", () => {
  it("loads a temporary JSON file", async () => {
    const filePath = await writeTempRegistry(registryJson([VALID_SOURCE]));
    const registry = await loadSourceRegistry(filePath);
    expect(registry.sources[0]?.id).toBe("openai-news");

    const viaUrl = await loadSourceRegistry(pathToFileURL(filePath));
    expect(viaUrl.sources[0]?.url).toBe(VALID_SOURCE.url);
  });

  it("defaults to resilient mode so one invalid source does not fatal the load", async () => {
    const { provider: _provider, ...withoutProvider } = VALID_SOURCE;
    const reports: Array<{ sourceId: string | null; action: string }> = [];
    const filePath = await writeTempRegistry(
      registryJson([
        withoutProvider,
        {
          ...VALID_SOURCE,
          id: "peer-ok",
          url: "https://example.com/peer.xml",
        },
      ]),
    );

    const registry = await loadSourceRegistry(filePath, {
      onInvalidSource: (report) => {
        reports.push({ sourceId: report.sourceId, action: report.action });
      },
    });

    expect(registry.sources.map((s) => s.id)).toEqual(["peer-ok"]);
    expect(reports).toEqual([
      { sourceId: "openai-news", action: "disabled" },
    ]);
  });

  it("rejects a missing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "radar-ia-sources-missing-"));
    tempDirs.push(dir);
    const missing = join(dir, "absent.json");

    await expect(loadSourceRegistry(missing)).rejects.toBeInstanceOf(
      InvalidSourceRegistryError,
    );
    await expect(loadSourceRegistry(missing)).rejects.toThrow(/not found/i);
  });
});

describe("getEnabledSources", () => {
  it("filters enabled sources and preserves order", () => {
    const registry = parseSourceRegistry(
      registryJson([
        { ...VALID_SOURCE, id: "a", url: "https://example.com/a.xml", enabled: true },
        { ...VALID_SOURCE, id: "b", url: "https://example.com/b.xml", enabled: false },
        { ...VALID_SOURCE, id: "c", url: "https://example.com/c.xml", enabled: true },
      ]),
    );

    const enabled = getEnabledSources(registry);
    expect(enabled.map((source) => source.id)).toEqual(["a", "c"]);
  });
});
