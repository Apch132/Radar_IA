/**
 * Base class for source registry failures.
 * Messages must help fix the config file and must never embed secrets.
 */
export class SourceRegistryError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SourceRegistryError";
  }
}

/** JSON shape, field values, or file load failures. */
export class InvalidSourceRegistryError extends SourceRegistryError {
  constructor(message = "Invalid source registry.", options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidSourceRegistryError";
  }
}

/** Two sources share the same id. */
export class DuplicateSourceIdError extends SourceRegistryError {
  readonly id: string;

  constructor(id: string, message?: string, options?: ErrorOptions) {
    super(message ?? `Duplicate source id: "${id}".`, options);
    this.name = "DuplicateSourceIdError";
    this.id = id;
  }
}

/** Two sources share the same normalized feed URL. */
export class DuplicateSourceUrlError extends SourceRegistryError {
  readonly url: string;

  constructor(url: string, message?: string, options?: ErrorOptions) {
    super(message ?? `Duplicate source URL: "${url}".`, options);
    this.name = "DuplicateSourceUrlError";
    this.url = url;
  }
}
