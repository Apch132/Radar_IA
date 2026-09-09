import type { LogLevel } from "@radar-ia/config";

export type WorkerLogFields = Record<string, unknown>;

export interface WorkerLogger {
  info(message: string, fields?: WorkerLogFields): void;
  warn(message: string, fields?: WorkerLogFields): void;
  error(message: string, fields?: WorkerLogFields): void;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 100,
  fatal: 60,
  error: 50,
  warn: 40,
  info: 30,
  debug: 20,
  trace: 10,
};

/**
 * Minimal structured console logger. Never log secrets or raw payloads.
 */
export function createWorkerLogger(logLevel: LogLevel): WorkerLogger {
  const threshold = LEVEL_ORDER[logLevel];

  function emit(
    level: "info" | "warn" | "error",
    message: string,
    fields?: WorkerLogFields,
  ): void {
    if (LEVEL_ORDER[level] < threshold) {
      return;
    }
    const line =
      fields === undefined
        ? `[worker] ${message}`
        : `[worker] ${message} ${JSON.stringify(fields)}`;
    if (level === "error") {
      console.error(line);
      return;
    }
    if (level === "warn") {
      // Mirror to stdout: Docker scrapes often surface console.info more
      // reliably than console.warn alone for structured incident greps.
      console.warn(line);
      console.info(line);
      return;
    }
    console.info(line);
  }

  return {
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
  };
}
