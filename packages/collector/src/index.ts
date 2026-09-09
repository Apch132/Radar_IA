export {
  ArticleNormalizationError,
  InvalidArticleUrlError,
  MissingArticleTitleError,
  MissingArticleUrlError,
} from "./article-errors.js";

export {
  canonicalizeArticleUrl,
  normalizeArticle,
  normalizeFeedArticles,
} from "./article-normalize.js";

export type {
  ArticleRejectionCategory,
  NormalizeFeedResult,
  NormalizedArticle,
  RejectedArticle,
} from "./article-types.js";

export {
  SourceCollectError,
  SourceEmptyBodyError,
  SourceFeedParseError,
  SourceHttpStatusError,
} from "./collect-errors.js";

export {
  createIncrementalCollector,
  type IncrementalCollector,
  type IncrementalCollectorOptions,
  type ParseFeedFn,
} from "./collect-source.js";

export type {
  CollectSourceNotModified,
  CollectSourceResult,
  CollectSourceUpdated,
  SourceFetchState,
} from "./collect-types.js";

export {
  ALLOWED_PROTOCOLS,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
  NULL_BODY_STATUS_CODES,
  REDIRECT_STATUS_CODES,
} from "./constants.js";

export {
  HttpClientError,
  InvalidUrlError,
  NetworkError,
  RedirectError,
  ResponseTooLargeError,
  SsrfBlockedError,
  TimeoutError,
} from "./errors.js";

export {
  FeedParseError,
  InvalidXmlError,
  UnrecognizedFeedFormatError,
} from "./feed-errors.js";

export { parseFeed } from "./feed-parser.js";

export type {
  FeedFormat,
  ParsedFeed,
  ParsedFeedItem,
} from "./feed-types.js";

export {
  buildWebResponse,
  createSecureHttpClient,
  type FetchLike,
  type HeaderInput,
  type SecureHttpClient,
  type SecureHttpClientOptions,
  type SecureHttpGetOptions,
  type SecureHttpResponse,
} from "./http-client.js";

export {
  DuplicateSourceIdError,
  DuplicateSourceUrlError,
  InvalidSourceRegistryError,
  SourceRegistryError,
} from "./source-errors.js";

export {
  getEnabledSources,
  loadSourceRegistry,
  parseSourceRegistry,
  type InvalidSourceReport,
  type LoadSourceRegistryOptions,
  type ParseSourceRegistryOptions,
} from "./source-registry.js";

export {
  SOURCE_TIERS,
  SOURCE_PROVIDER_TYPES,
  ACTIVE_SOURCE_PROVIDER_TYPES,
  DISABLED_SOURCE_PROVIDER_TYPES,
  type SourceDefinition,
  type SourceProviderType,
  type SourceRegistry,
  type SourceTier,
} from "./source-types.js";

export {
  createAtomProvider,
  createDisabledProvider,
  createGithubReleasesProvider,
  createRssProvider,
  resolveProvider,
  type SourceProvider,
  type SourceProviderContext,
  type SourceProviderFactory,
} from "./providers/index.js";

export {
  assertSafeDestination,
  resolveSafeDestination,
  defaultDnsLookup,
  isBlockedIpAddress,
  parseHttpUrl,
  type DnsLookup,
  type SafeDestination,
} from "./ssrf.js";
