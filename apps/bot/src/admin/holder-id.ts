import { hostname } from "node:os";
import { randomBytes } from "node:crypto";

/** Max length for a pipeline lock holder id (bounded, no secrets). */
export const HOLDER_ID_MAX_LENGTH = 128;

export type CreateHolderIdOptions = {
  readonly prefix: string;
  readonly host?: string;
  readonly pid?: number;
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
 * Process-stable holder id for manual Discord-triggered cycles.
 * Format: `<prefix>:<host>:<pid>:<suffix>` — never contains secrets.
 */
export function createBotHolderId(options: CreateHolderIdOptions): string {
  const prefix = sanitizeSegment(options.prefix, "bot");
  const host = sanitizeSegment(options.host ?? hostname(), "host");
  const pid = String(options.pid ?? process.pid);
  const suffix = options.randomSuffix ?? randomBytes(3).toString("hex");

  let id = `${prefix}:${host}:${pid}:${suffix}`;
  if (id.length > HOLDER_ID_MAX_LENGTH) {
    id = id.slice(0, HOLDER_ID_MAX_LENGTH);
  }
  return id;
}
