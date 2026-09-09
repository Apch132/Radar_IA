import { hostname } from "node:os";
import { randomBytes } from "node:crypto";

/** Max length for a pipeline lock holder id (bounded, no secrets). */
export const HOLDER_ID_MAX_LENGTH = 128;

export type CreateHolderIdOptions = {
  readonly prefix: string;
  /** Injectable hostname (defaults to os.hostname). */
  readonly host?: string;
  /** Injectable process id (defaults to process.pid). */
  readonly pid?: number;
  /** Injectable random suffix (defaults to 6 hex chars). */
  readonly randomSuffix?: string;
};

function sanitizeSegment(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Build a process-stable holder id for the single-flight lock.
 * Format: `<prefix>:<host>:<pid>:<suffix>` — never contains secrets.
 */
export function createHolderId(options: CreateHolderIdOptions): string {
  const prefix = sanitizeSegment(options.prefix, "worker");
  const host = sanitizeSegment(options.host ?? hostname(), "host");
  const pid = String(options.pid ?? process.pid);
  const suffix =
    options.randomSuffix ?? randomBytes(3).toString("hex");

  let id = `${prefix}:${host}:${pid}:${suffix}`;
  if (id.length > HOLDER_ID_MAX_LENGTH) {
    id = id.slice(0, HOLDER_ID_MAX_LENGTH);
  }
  return id;
}
