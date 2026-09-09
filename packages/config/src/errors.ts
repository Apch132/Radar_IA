import { ZodError, type ZodIssue } from "zod";

import { SECRET_ENV_KEYS } from "./schema.js";

const SECRET_KEY_SET = new Set<string>(SECRET_ENV_KEYS);

/**
 * Configuration validation error that never embeds secret values.
 * Messages only expose environment variable names and safe reason codes.
 */
export class ConfigurationError extends Error {
  readonly invalidVariables: readonly string[];

  constructor(invalidVariables: readonly string[], details: readonly string[]) {
    const unique = [...new Set(invalidVariables)].sort();
    super(
      [
        "Invalid environment configuration.",
        `Invalid or missing variables: ${unique.join(", ") || "(unknown)"}.`,
        ...details.map((line) => `- ${line}`),
      ].join("\n"),
    );
    this.name = "ConfigurationError";
    this.invalidVariables = unique;
  }
}

function envKeyFromPath(path: ZodIssue["path"]): string {
  const first = path[0];
  return typeof first === "string" ? first : "(unknown)";
}

/** Strip any accidental secret fragments from a reason string. */
function sanitizeReason(envKey: string, reason: string): string {
  let safe = reason.replace(/[\r\n\t]+/g, " ").trim();

  if (SECRET_KEY_SET.has(envKey) || envKey === "DATABASE_URL") {
    // Never keep URLs, tokens, or password-looking fragments from Zod internals.
    safe = safe
      .replace(/postgres(ql)?:\/\/\S+/gi, "[redacted]")
      .replace(/\b[A-Za-z0-9_-]{20,}\b/g, "[redacted]");
  }

  return safe || "invalid";
}

export function configurationErrorFromZod(error: ZodError): ConfigurationError {
  const invalidVariables: string[] = [];
  const details: string[] = [];

  for (const issue of error.issues) {
    const envKey = envKeyFromPath(issue.path);
    invalidVariables.push(envKey);

    // Use issue.code + generic message only — never issue.received / input values.
    const reason = sanitizeReason(envKey, issue.message);
    details.push(`${envKey}: ${reason}`);
  }

  return new ConfigurationError(invalidVariables, details);
}

export function configurationErrorFromMessage(
  invalidVariables: readonly string[],
  detail: string,
): ConfigurationError {
  return new ConfigurationError(invalidVariables, [detail]);
}
