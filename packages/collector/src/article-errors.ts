/**
 * Base class for article normalization failures.
 * Messages must never embed full article bodies or secrets.
 */
export class ArticleNormalizationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArticleNormalizationError";
  }
}

/** Required title is missing or empty after normalization. */
export class MissingArticleTitleError extends ArticleNormalizationError {
  constructor(
    message = "Article title is required.",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MissingArticleTitleError";
  }
}

/** Required article URL is missing or empty. */
export class MissingArticleUrlError extends ArticleNormalizationError {
  constructor(
    message = "Article URL is required.",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MissingArticleUrlError";
  }
}

/** Article URL is not a usable absolute HTTP(S) URL. */
export class InvalidArticleUrlError extends ArticleNormalizationError {
  constructor(
    message = "Article URL is invalid or not allowed.",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "InvalidArticleUrlError";
  }
}
