/** Default request timeout (ms). */
export const DEFAULT_TIMEOUT_MS = 15_000;

/** Maximum HTTP redirects followed for a single request. */
export const DEFAULT_MAX_REDIRECTS = 5;

/**
 * Maximum response body size in bytes.
 * Sized for typical RSS/Atom feeds without allowing unbounded memory use.
 */
export const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;

/** Centralized User-Agent sent on every outbound request. */
export const DEFAULT_USER_AGENT =
  "RadarIA/0.5 (+https://github.com/Apch132/Radar_IA)";

/** Protocols allowed by the secure HTTP client. */
export const ALLOWED_PROTOCOLS = new Set(["http:", "https:"] as const);

/** Redirect status codes that may carry a Location target. */
export const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

/**
 * HTTP statuses for which the Fetch `Response` body must be `null`.
 * Subset of the Fetch null-body list that Undici accepts (status 200–599):
 * 204, 205, 304. (101 / 103 are not constructible via `Response` in Node.)
 * @see https://fetch.spec.whatwg.org/#null-body-status
 */
export const NULL_BODY_STATUS_CODES = new Set([204, 205, 304]);
