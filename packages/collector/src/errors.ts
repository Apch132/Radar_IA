/**
 * Base class for secure HTTP client failures.
 * Messages are intentional and must never embed secrets or response bodies.
 */
export class HttpClientError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "HttpClientError";
  }
}

/** URL is malformed or uses a disallowed protocol. */
export class InvalidUrlError extends HttpClientError {
  constructor(message = "Invalid or disallowed URL.", options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidUrlError";
  }
}

/** Destination hostname or resolved address is blocked by SSRF rules. */
export class SsrfBlockedError extends HttpClientError {
  constructor(
    message = "Request blocked: destination is not allowed.",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SsrfBlockedError";
  }
}

/** Request aborted after the configured timeout. */
export class TimeoutError extends HttpClientError {
  constructor(message = "Request timed out.", options?: ErrorOptions) {
    super(message, options);
    this.name = "TimeoutError";
  }
}

/** Low-level network failure (DNS/transport) after validation. */
export class NetworkError extends HttpClientError {
  constructor(message = "Network request failed.", options?: ErrorOptions) {
    super(message, options);
    this.name = "NetworkError";
  }
}

/** Redirect chain is invalid, loops, or exceeds the configured limit. */
export class RedirectError extends HttpClientError {
  constructor(message = "Invalid or excessive HTTP redirect.", options?: ErrorOptions) {
    super(message, options);
    this.name = "RedirectError";
  }
}

/** Response body exceeds the configured size limit. */
export class ResponseTooLargeError extends HttpClientError {
  constructor(
    message = "Response body exceeds the maximum allowed size.",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ResponseTooLargeError";
  }
}
