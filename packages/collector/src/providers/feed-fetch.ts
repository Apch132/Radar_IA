import {
  SourceEmptyBodyError,
  SourceFeedParseError,
  SourceHttpStatusError,
} from "../collect-errors.js";
import type {
  CollectSourceResult,
  SourceFetchState,
} from "../collect-types.js";
import type { ParseFeedFn } from "../collect-source.js";
import type { FeedFormat } from "../feed-types.js";
import type { SecureHttpClient } from "../http-client.js";
import type { SourceDefinition } from "../source-types.js";

function normalizeValidator(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function readResponseValidators(headers: Headers): {
  etag: string | undefined;
  lastModified: string | undefined;
} {
  return {
    etag: normalizeValidator(headers.get("etag")),
    lastModified: normalizeValidator(headers.get("last-modified")),
  };
}

/**
 * Build the next serializable state without mutating `previous`.
 * New validators from the response replace earlier ones; absent headers keep
 * the previous values (merge strategy for 304 and 2xx alike).
 */
export function nextFetchState(
  previous: SourceFetchState | undefined,
  headers: Headers,
): SourceFetchState {
  const fromResponse = readResponseValidators(headers);
  const etag = fromResponse.etag ?? previous?.etag;
  const lastModified = fromResponse.lastModified ?? previous?.lastModified;

  const state: { etag?: string; lastModified?: string } = {};
  if (etag !== undefined) {
    state.etag = etag;
  }
  if (lastModified !== undefined) {
    state.lastModified = lastModified;
  }
  return state;
}

export function buildConditionalHeaders(
  state: SourceFetchState | undefined,
): Record<string, string> | undefined {
  if (state === undefined) {
    return undefined;
  }

  const headers: Record<string, string> = {};
  const etag = normalizeValidator(state.etag);
  const lastModified = normalizeValidator(state.lastModified);

  if (etag !== undefined) {
    headers["If-None-Match"] = etag;
  }
  if (lastModified !== undefined) {
    headers["If-Modified-Since"] = lastModified;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 300;
}

export type FeedFetchOptions = {
  readonly httpClient: SecureHttpClient;
  readonly parseFeed: ParseFeedFn;
  /** When set, reject feeds whose detected format does not match. */
  readonly expectedFormat?: FeedFormat;
};

/**
 * Shared incremental HTTP fetch + feed parse used by RSS / Atom / GitHub Releases.
 */
export async function fetchAndParseFeed(
  source: SourceDefinition,
  state: SourceFetchState | undefined,
  options: FeedFetchOptions,
): Promise<CollectSourceResult> {
  const requestHeaders = buildConditionalHeaders(state);
  const response = await options.httpClient.get(
    source.url,
    requestHeaders === undefined ? undefined : { headers: requestHeaders },
  );

  if (response.status === 304) {
    return {
      status: "not-modified",
      source,
      state: nextFetchState(state, response.headers),
      httpStatus: 304,
    };
  }

  if (!isSuccessStatus(response.status)) {
    throw new SourceHttpStatusError(source.id, source.url, response.status);
  }

  if (response.body.byteLength === 0) {
    throw new SourceEmptyBodyError(source.id, source.url);
  }

  let feed;
  try {
    feed = options.parseFeed(response.body);
  } catch (cause) {
    throw new SourceFeedParseError(source.id, source.url, undefined, {
      cause,
    });
  }

  if (
    options.expectedFormat !== undefined &&
    feed.format !== options.expectedFormat
  ) {
    throw new SourceFeedParseError(
      source.id,
      source.url,
      `Source "${source.id}" expected ${options.expectedFormat} feed but received ${feed.format}.`,
    );
  }

  return {
    status: "updated",
    source,
    state: nextFetchState(state, response.headers),
    httpStatus: response.status,
    feed,
  };
}
