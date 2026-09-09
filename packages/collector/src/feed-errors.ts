/**
 * Base class for feed reader failures.
 * Messages are intentional and must never embed full raw payloads.
 */
export class FeedParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FeedParseError";
  }
}

/** Input is not well-formed XML. */
export class InvalidXmlError extends FeedParseError {
  constructor(message = "Invalid XML.", options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidXmlError";
  }
}

/** XML parsed but root is neither RSS 2.0 nor Atom 1.0. */
export class UnrecognizedFeedFormatError extends FeedParseError {
  constructor(
    message = "Unrecognized feed format: expected RSS 2.0 or Atom 1.0.",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "UnrecognizedFeedFormatError";
  }
}
