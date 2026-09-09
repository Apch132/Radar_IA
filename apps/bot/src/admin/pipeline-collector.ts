import {
  createIncrementalCollector,
  normalizeFeedArticles as collectorNormalizeFeedArticles,
  parseFeed,
  type ParsedFeed,
  type SecureHttpClient,
  type SourceDefinition,
  type SourceTier,
} from "@radar-ia/collector";
import type {
  PipelineArticleNormalizer,
  PipelineIncrementalCollector,
  PipelineSourceDefinition,
} from "@radar-ia/database";

function asSourceDefinition(
  source: PipelineSourceDefinition,
): SourceDefinition {
  const provider =
    source.provider === "atom" ||
    source.provider === "github_releases" ||
    source.provider === "html" ||
    source.provider === "api" ||
    source.provider === "rss"
      ? source.provider
      : "rss";
  return {
    id: source.id,
    name: source.name,
    url: source.url,
    tier: source.tier as SourceTier,
    enabled: source.enabled,
    provider,
  };
}

export type PipelineCollectAdapters = {
  readonly collector: PipelineIncrementalCollector;
  readonly normalizeFeedArticles: PipelineArticleNormalizer["normalizeFeedArticles"];
};

/**
 * Adapter: collector 004 → pipeline ports (same wiring as worker 009.1D).
 */
export function createPipelineCollectAdapters(
  httpClient: SecureHttpClient,
): PipelineCollectAdapters {
  let lastRawBody = "";
  let lastFeed: ParsedFeed | null = null;

  const inner = createIncrementalCollector({
    httpClient,
    parseFeed: (input) => {
      lastRawBody =
        typeof input === "string"
          ? input
          : new TextDecoder("utf-8").decode(input);
      lastFeed = parseFeed(input);
      return lastFeed;
    },
  });

  const collector: PipelineIncrementalCollector = {
    async collect(source, state) {
      const result = await inner.collect(asSourceDefinition(source), state);
      if (result.status === "not-modified") {
        return {
          status: "not-modified",
          source,
          state: result.state,
          httpStatus: 304,
        };
      }

      return {
        status: "updated",
        source,
        state: result.state,
        httpStatus: result.httpStatus,
        feed: {
          format: result.feed.format,
          title: result.feed.title ?? undefined,
          items: result.feed.items.map((item) => ({
            id: item.id ?? undefined,
            title: item.title ?? undefined,
            link: item.link ?? undefined,
            publishedAt: item.publishedAt?.toISOString(),
            author: item.author ?? undefined,
            summary: item.summary ?? undefined,
            content: item.content ?? undefined,
            categories: item.categories,
          })),
        },
        rawBody: lastRawBody,
      };
    },
  };

  const normalizeFeedArticles: PipelineArticleNormalizer["normalizeFeedArticles"] =
    (source, feed) => {
      const collectorFeed: ParsedFeed =
        lastFeed ??
        ({
          format: feed.format === "atom" ? "atom" : "rss",
          title: feed.title ?? null,
          description: null,
          link: null,
          language: null,
          updatedAt: null,
          items: feed.items.map((item) => ({
            id: item.id ?? null,
            title: item.title ?? null,
            link: item.link ?? null,
            summary: item.summary ?? null,
            author: item.author ?? null,
            publishedAt: item.publishedAt ? new Date(item.publishedAt) : null,
            categories: [...(item.categories ?? [])],
            content: item.content ?? null,
          })),
        } satisfies ParsedFeed);

      const result = collectorNormalizeFeedArticles(
        asSourceDefinition(source),
        collectorFeed,
      );

      return {
        articles: result.articles.map((article) => ({
          sourceId: article.sourceId,
          sourceTier: article.sourceTier,
          ...(article.externalId !== undefined
            ? { externalId: article.externalId }
            : {}),
          title: article.title,
          url: article.url,
          ...(article.publishedAt !== undefined
            ? { publishedAt: article.publishedAt }
            : {}),
          ...(article.updatedAt !== undefined
            ? { updatedAt: article.updatedAt }
            : {}),
          ...(article.author !== undefined ? { author: article.author } : {}),
          ...(article.summary !== undefined ? { summary: article.summary } : {}),
          ...(article.content !== undefined ? { content: article.content } : {}),
          categories: article.categories,
          feedFormat: article.feedFormat,
        })),
        rejected: result.rejected.map((entry) => ({
          reason: entry.message,
          category: entry.category,
        })),
      };
    };

  return { collector, normalizeFeedArticles };
}
