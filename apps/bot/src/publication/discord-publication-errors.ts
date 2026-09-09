import { DiscordAPIError } from "discord.js";
import {
  DiscordPublicationPortError,
  type DiscordPublicationPortErrorCode,
} from "@radar-ia/database";

const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function messageIncludes(value: string, needle: string): boolean {
  return value.toLowerCase().includes(needle.toLowerCase());
}

function isTimeoutLike(error: Error & { code?: string }): boolean {
  const code = error.code?.toUpperCase();
  if (code !== undefined && code.includes("TIMEOUT")) {
    return true;
  }
  return (
    messageIncludes(error.message, "timeout") ||
    messageIncludes(error.message, "timed out")
  );
}

function isNetworkLike(error: Error & { code?: string }): boolean {
  const code = error.code?.toUpperCase();
  if (code !== undefined && NETWORK_ERROR_CODES.has(code)) {
    return true;
  }
  return (
    messageIncludes(error.message, "network") ||
    messageIncludes(error.message, "fetch failed") ||
    messageIncludes(error.message, "socket hang up")
  );
}

function sanitizeDetail(detail: string): string {
  return detail.replace(/[\r\n\t]+/g, " ").trim();
}

export function throwPublicationPortError(
  code: DiscordPublicationPortErrorCode,
  detail: string,
  options: { retryable?: boolean } = {},
): never {
  throw new DiscordPublicationPortError(code, sanitizeDetail(detail), options);
}

export function normalizeDiscordError(
  error: unknown,
  fallback: {
    unknownCode?: DiscordPublicationPortErrorCode;
    unknownMessage: string;
  },
): never {
  if (error instanceof DiscordPublicationPortError) {
    throw error;
  }

  if (error instanceof DiscordAPIError) {
    switch (error.code) {
      case 10003:
      case 10004:
      case 50001:
        throwPublicationPortError("channel_unavailable", error.message, {
          retryable: true,
        });
      case 10008:
      case 10083:
        throwPublicationPortError("inconsistent_state", error.message, {
          retryable: false,
        });
      case 50013:
        throwPublicationPortError("missing_permission", error.message, {
          retryable: false,
        });
      default:
        if (error.status >= 500) {
          throwPublicationPortError("discord_unavailable", error.message, {
            retryable: true,
          });
        }
        throwPublicationPortError(
          fallback.unknownCode ?? "unknown",
          `${fallback.unknownMessage}: ${error.message}`,
          { retryable: false },
        );
    }
  }

  if (error instanceof Error) {
    const typed = error as Error & { code?: string };
    if (isTimeoutLike(typed)) {
      throwPublicationPortError("discord_timeout", error.message, {
        retryable: true,
      });
    }
    if (isNetworkLike(typed)) {
      throwPublicationPortError("discord_unavailable", error.message, {
        retryable: true,
      });
    }
    throwPublicationPortError(
      fallback.unknownCode ?? "unknown",
      `${fallback.unknownMessage}: ${error.message}`,
      { retryable: false },
    );
  }

  throwPublicationPortError(
    fallback.unknownCode ?? "unknown",
    `${fallback.unknownMessage}: ${String(error)}`,
    { retryable: false },
  );
}
