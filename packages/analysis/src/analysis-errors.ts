import type { AnalysisClientErrorCode } from "./analysis-proposal-types.js";

/**
 * Normalized client-side analysis error (no business decision).
 */
export class AnalysisClientError extends Error {
  readonly code: AnalysisClientErrorCode;
  readonly attempts: number;
  override readonly cause?: unknown;

  constructor(
    code: AnalysisClientErrorCode,
    message: string,
    options?: { attempts?: number; cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AnalysisClientError";
    this.code = code;
    this.attempts = options?.attempts ?? 0;
    this.cause = options?.cause;
  }
}
