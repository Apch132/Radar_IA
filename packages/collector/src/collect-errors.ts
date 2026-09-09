/**
 * Base class for incremental source collection failures.
 * Messages must never embed secrets or full response bodies.
 */
export class SourceCollectError extends Error {
  readonly sourceId: string;

  constructor(
    sourceId: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SourceCollectError";
    this.sourceId = sourceId;
  }
}

/** HTTP status is neither 304 nor a usable 2xx. */
export class SourceHttpStatusError extends SourceCollectError {
  readonly httpStatus: number;
  readonly sourceUrl: string;

  constructor(
    sourceId: string,
    sourceUrl: string,
    httpStatus: number,
    message?: string,
    options?: ErrorOptions,
  ) {
    super(
      sourceId,
      message ??
        `Source "${sourceId}" returned HTTP ${String(httpStatus)}.`,
      options,
    );
    this.name = "SourceHttpStatusError";
    this.httpStatus = httpStatus;
    this.sourceUrl = sourceUrl;
  }
}

/** Response was 2xx but the body was empty. */
export class SourceEmptyBodyError extends SourceCollectError {
  readonly sourceUrl: string;

  constructor(
    sourceId: string,
    sourceUrl: string,
    message?: string,
    options?: ErrorOptions,
  ) {
    super(
      sourceId,
      message ?? `Source "${sourceId}" returned an empty response body.`,
      options,
    );
    this.name = "SourceEmptyBodyError";
    this.sourceUrl = sourceUrl;
  }
}

/** Feed parsing failed; original parse error is preserved as `cause`. */
export class SourceFeedParseError extends SourceCollectError {
  readonly sourceUrl: string;

  constructor(
    sourceId: string,
    sourceUrl: string,
    message?: string,
    options?: ErrorOptions,
  ) {
    super(
      sourceId,
      message ?? `Failed to parse feed for source "${sourceId}".`,
      options,
    );
    this.name = "SourceFeedParseError";
    this.sourceUrl = sourceUrl;
  }
}
