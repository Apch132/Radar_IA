import * as http from "node:http";
import * as https from "node:https";
import { isIP } from "node:net";
import type { IncomingMessage } from "node:http";

import {
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_REDIRECTS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_USER_AGENT,
  NULL_BODY_STATUS_CODES,
  REDIRECT_STATUS_CODES,
} from "./constants.js";
import {
  NetworkError,
  RedirectError,
  ResponseTooLargeError,
  TimeoutError,
} from "./errors.js";
import {
  resolveSafeDestination,
  defaultDnsLookup,
  type DnsLookup,
  type SafeDestination,
} from "./ssrf.js";

export type HeaderInput =
  | Headers
  | Record<string, string>
  | Array<[string, string]>;

export type FetchLike = (
  input: string | URL,
  init?: {
    method?: string;
    headers?: HeaderInput;
    redirect?: "error" | "follow" | "manual";
    signal?: AbortSignal;
  },
) => Promise<Response>;

export interface SecureHttpClientOptions {
  /** Injectable fetch implementation (defaults to pinned Node http(s)). */
  fetch?: FetchLike;
  /** Injectable DNS resolver used by SSRF checks. */
  lookup?: DnsLookup;
  /** Per-request timeout in milliseconds. */
  timeoutMs?: number;
  /** Maximum number of redirects to follow. */
  maxRedirects?: number;
  /** Maximum response body size in bytes. */
  maxBodyBytes?: number;
  /** User-Agent header applied to every request. */
  userAgent?: string;
}

export interface SecureHttpGetOptions {
  /** Additional request headers. User-Agent cannot be removed. */
  headers?: HeaderInput;
}

export interface SecureHttpResponse {
  status: number;
  statusText: string;
  headers: Headers;
  /** Raw response body suitable for later XML/RSS parsing. */
  body: Uint8Array;
  /** Final URL after validated redirects. */
  url: string;
}

export interface SecureHttpClient {
  get(
    url: string | URL,
    options?: SecureHttpGetOptions,
  ): Promise<SecureHttpResponse>;
}

function combineSignals(
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return {
    signal: timeoutSignal,
    cleanup: () => {
      // AbortSignal.timeout is cleaned up when aborted/settled by the runtime.
    },
  };
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: string }).name === "AbortError"
  );
}

function isTimeoutAbort(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name: string }).name === "TimeoutError"
  ) {
    return true;
  }
  return isAbortError(error);
}

function buildHeaders(userAgent: string, extra?: HeaderInput): Headers {
  let headers: Headers;
  if (extra === undefined) {
    headers = new Headers();
  } else if (extra instanceof Headers) {
    headers = new Headers(extra);
  } else if (Array.isArray(extra)) {
    headers = new Headers(extra);
  } else {
    headers = new Headers(extra);
  }
  headers.set("User-Agent", userAgent);
  return headers;
}

async function readBodyLimited(
  response: Response,
  maxBodyBytes: number,
): Promise<Uint8Array> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBodyBytes) {
      if (response.body) {
        await response.body.cancel().catch(() => undefined);
      }
      throw new ResponseTooLargeError();
    }
  }

  if (!response.body) {
    return new Uint8Array(0);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      total += value.byteLength;
      if (total > maxBodyBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ResponseTooLargeError();
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ResponseTooLargeError) {
      throw error;
    }
    await reader.cancel().catch(() => undefined);
    throw error;
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function resolveRedirectUrl(currentUrl: URL, locationHeader: string | null): URL {
  if (locationHeader === null || locationHeader.trim() === "") {
    throw new RedirectError("Redirect response is missing a Location header.");
  }

  try {
    return new URL(locationHeader, currentUrl);
  } catch (cause) {
    throw new RedirectError("Redirect Location header is not a valid URL.", {
      cause,
    });
  }
}

function headersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

/**
 * Build a Fetch `Response` that respects null-body status codes (e.g. 304).
 * Passing a Buffer/Uint8Array body for those statuses throws in undici/Node.
 */
export function buildWebResponse(
  status: number,
  statusText: string,
  headers: Headers,
  body: Buffer | Uint8Array,
): Response {
  const init = { status, statusText, headers };
  if (NULL_BODY_STATUS_CODES.has(status)) {
    return new Response(null, init);
  }
  return new Response(body, init);
}

/**
 * Connect to the pinned IP while preserving Host / SNI for the original hostname.
 */
function pinnedNodeFetch(
  destination: SafeDestination,
  init: {
    method: string;
    headers: Headers;
    signal: AbortSignal;
  },
): Promise<Response> {
  const family = isIP(destination.pinnedAddress) === 6 ? 6 : 4;
  const isHttps = destination.url.protocol === "https:";
  const transport = isHttps ? https : http;
  const port =
    destination.url.port !== ""
      ? Number(destination.url.port)
      : isHttps
        ? 443
        : 80;

  const headers = headersToRecord(init.headers);
  if (!("host" in headers) && !("Host" in headers)) {
    headers.Host =
      destination.url.port === ""
        ? destination.hostname
        : `${destination.hostname}:${destination.url.port}`;
  }

  return new Promise<Response>((resolve, reject) => {
    const request = transport.request(
      {
        protocol: destination.url.protocol,
        hostname: destination.pinnedAddress,
        family,
        port,
        path: `${destination.url.pathname}${destination.url.search}`,
        method: init.method,
        headers,
        servername: isHttps ? destination.hostname : undefined,
        signal: init.signal,
      },
      (incoming: IncomingMessage) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
        incoming.on("end", () => {
          const body = Buffer.concat(chunks);
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(incoming.headers)) {
            if (value === undefined) continue;
            if (Array.isArray(value)) {
              for (const item of value) responseHeaders.append(key, item);
            } else {
              responseHeaders.set(key, value);
            }
          }
          resolve(
            buildWebResponse(
              incoming.statusCode ?? 0,
              incoming.statusMessage ?? "",
              responseHeaders,
              body,
            ),
          );
        });
        incoming.on("error", reject);
      },
    );
    request.on("error", reject);
    request.end();
  });
}

/**
 * Creates a minimal secure HTTP client for outbound collector fetches.
 * No RSS/Atom parsing, retries, or caching are included.
 */
export function createSecureHttpClient(
  options: SecureHttpClientOptions = {},
): SecureHttpClient {
  const fetchImpl = options.fetch;
  const lookup = options.lookup ?? defaultDnsLookup;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  async function get(
    input: string | URL,
    getOptions: SecureHttpGetOptions = {},
  ): Promise<SecureHttpResponse> {
    let destination = await resolveSafeDestination(input, lookup);
    const headers = buildHeaders(userAgent, getOptions.headers);
    const visited = new Set<string>();

    for (let redirectCount = 0; ; redirectCount += 1) {
      const key = destination.url.href;
      if (visited.has(key)) {
        throw new RedirectError("Redirect loop detected.");
      }
      visited.add(key);

      const { signal, cleanup } = combineSignals(timeoutMs);

      let response: Response;
      try {
        if (fetchImpl !== undefined) {
          response = await fetchImpl(destination.url, {
            method: "GET",
            headers,
            redirect: "manual",
            signal,
          });
        } else {
          response = await pinnedNodeFetch(destination, {
            method: "GET",
            headers,
            signal,
          });
        }
      } catch (error) {
        cleanup();
        if (isTimeoutAbort(error)) {
          throw new TimeoutError(undefined, { cause: error });
        }
        throw new NetworkError(undefined, { cause: error });
      } finally {
        cleanup();
      }

      if (REDIRECT_STATUS_CODES.has(response.status)) {
        if (response.body) {
          await response.body.cancel().catch(() => undefined);
        }

        if (redirectCount >= maxRedirects) {
          throw new RedirectError(
            `Exceeded maximum redirects (${String(maxRedirects)}).`,
          );
        }

        const nextUrl = resolveRedirectUrl(
          destination.url,
          response.headers.get("location"),
        );
        destination = await resolveSafeDestination(nextUrl, lookup);
        continue;
      }

      const body = await readBodyLimited(response, maxBodyBytes);
      return {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
        body,
        url: destination.url.href,
      };
    }
  }

  return { get };
}
