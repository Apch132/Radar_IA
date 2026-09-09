import {
  OLLAMA_INFERENCE_TIMEOUT_MS,
  OLLAMA_MAX_ATTEMPTS,
  OLLAMA_MAX_CONCURRENCY,
  OLLAMA_MAX_RESPONSE_BYTES,
  OLLAMA_QUEUE_TIMEOUT_MS,
  OLLAMA_RETRY_DELAYS_MS,
} from "./analysis-constants.js";
import { AnalysisClientError } from "./analysis-errors.js";
import type {
  AnalysisClientErrorCode,
  AnalysisProposalV1,
} from "./analysis-proposal-types.js";
import { parseAnalysisProposalJson } from "./validate-analysis-proposal.js";

export type FetchLike = (
  input: string | URL,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<Response>;

export type SleepFn = (ms: number) => Promise<void>;

export interface OllamaClientConfig {
  /** Ollama base URL (e.g. http://localhost:11434). */
  readonly baseUrl: string;
  /** Exact model tag (Ministral 3 3B / Modelfile). */
  readonly model: string;
  /** Must be 1 (gel). Defaults to 1. */
  readonly maxConcurrency?: typeof OLLAMA_MAX_CONCURRENCY;
}

export interface CreateOllamaAnalysisClientOptions {
  readonly config: OllamaClientConfig;
  /** Injectable fetch (defaults to global fetch). */
  readonly fetch?: FetchLike;
  /** Injectable sleep for retries (defaults to setTimeout). */
  readonly sleep?: SleepFn;
  /** Per-attempt inference timeout (default 90s). */
  readonly inferenceTimeoutMs?: number;
  /** Queue / lock wait timeout (default 300s). */
  readonly queueTimeoutMs?: number;
  /** Max attempts including the first (default 3). */
  readonly maxAttempts?: number;
  /** Delays before 2nd and 3rd attempts (default 5s, 15s). */
  readonly retryDelaysMs?: readonly [number, number];
  /**
   * Optional system instructions prepended to the user prompt.
   * Prompt text itself is supplied per call (007.1D owns budget assembly).
   */
  readonly defaultSystemPrompt?: string;
  /** Max response body bytes (default 1_000_000). */
  readonly maxResponseBytes?: number;
  /**
   * Optional cross-process lease acquired around the local slot (AUD-003).
   * Returns a release function.
   */
  readonly acquireInferenceLease?: () => Promise<() => Promise<void>>;
}

export interface AnalysisInferenceInput {
  /** Assembled user / context prompt (already budgeted by caller). */
  readonly prompt: string;
  /** Overrides defaultSystemPrompt for this call. */
  readonly systemPrompt?: string;
}

export type AnalysisInferenceSuccess = {
  readonly ok: true;
  readonly proposal: AnalysisProposalV1;
  readonly rawText: string;
  readonly modelId: string;
  readonly attempts: number;
  readonly durationMs: number;
};

export type AnalysisInferenceFailure = {
  readonly ok: false;
  readonly errorCode: AnalysisClientErrorCode;
  readonly message: string;
  readonly attempts: number;
  readonly rawText?: string;
  readonly cause?: unknown;
  readonly stage:
    | "request"
    | "transport"
    | "timeout"
    | "http"
    | "parse"
    | "schema_validation"
    | "lease";
  readonly statusCode?: number;
  readonly durationMs: number;
  readonly retryable: boolean;
  /** More precise code for logs (e.g. model_absent) — not necessarily a DB enum. */
  readonly logErrorCode: string;
};

export type AnalysisInferenceResult =
  | AnalysisInferenceSuccess
  | AnalysisInferenceFailure;

export interface OllamaAnalysisClient {
  /**
   * Run a single dossier inference under the global concurrency slot.
   * Returns a validated proposal or a normalized error — no business decision.
   */
  infer(input: AnalysisInferenceInput): Promise<AnalysisInferenceResult>;
  readonly baseUrl: string;
  readonly model: string;
}

interface OllamaGenerateResponse {
  readonly model?: string;
  readonly response?: string;
  readonly error?: string;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function joinUrl(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  return `${base}${path}`;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    ((error as { name: string }).name === "AbortError" ||
      (error as { name: string }).name === "TimeoutError")
  );
}

function toFailure(
  code: AnalysisClientErrorCode,
  message: string,
  attempts: number,
  extras?: {
    rawText?: string;
    cause?: unknown;
    stage?: AnalysisInferenceFailure["stage"];
    statusCode?: number;
    durationMs?: number;
    retryable?: boolean;
    logErrorCode?: string;
  },
): AnalysisInferenceFailure {
  const stage =
    extras?.stage ??
    (code === "inference_timeout"
      ? "timeout"
      : code === "invalid_json" ||
          code === "schema_violation" ||
          code === "empty_summary"
        ? "parse"
        : code === "queue_timeout"
          ? "lease"
          : "transport");
  const lower = message.toLowerCase();
  let logErrorCode = extras?.logErrorCode;
  if (logErrorCode === undefined) {
    if (
      lower.includes("model") &&
      (lower.includes("not found") ||
        lower.includes("does not exist") ||
        lower.includes("pull"))
    ) {
      logErrorCode = "model_absent";
    } else if (code === "inference_timeout") {
      logErrorCode = "timeout";
    } else if (code === "invalid_json" && lower.includes("empty")) {
      logErrorCode = "empty_response";
    } else if (code === "schema_violation" || code === "empty_summary") {
      logErrorCode = "schema_validation";
    } else if (extras?.statusCode !== undefined && extras.statusCode >= 400) {
      logErrorCode = "http_error";
    } else if (code === "ollama_unavailable") {
      logErrorCode = "server_unreachable";
    } else {
      logErrorCode = code;
    }
  }
  return {
    ok: false,
    errorCode: code,
    message,
    attempts,
    rawText: extras?.rawText,
    cause: extras?.cause,
    stage,
    statusCode: extras?.statusCode,
    durationMs: extras?.durationMs ?? 0,
    retryable: extras?.retryable ?? true,
    logErrorCode,
  };
}

/**
 * FIFO mutex with wait timeout (gel 007.1A §10 / §13).
 * Concurrency is always 1.
 */
class InferenceSlot {
  private readonly queueTimeoutMs: number;
  private locked = false;
  private readonly waiters: Array<{
    resolve: (release: () => void) => void;
    reject: (error: AnalysisClientError) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  constructor(queueTimeoutMs: number) {
    this.queueTimeoutMs = queueTimeoutMs;
  }

  acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return Promise.resolve(() => this.release());
    }

    return new Promise<() => void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        reject(
          new AnalysisClientError(
            "queue_timeout",
            `waited more than ${this.queueTimeoutMs}ms for the Ollama inference slot`,
          ),
        );
      }, this.queueTimeoutMs);

      this.waiters.push({
        resolve: (release) => {
          clearTimeout(timer);
          resolve(release);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        timer,
      });
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next.resolve(() => this.release());
      return;
    }
    this.locked = false;
  }
}

function buildPromptBody(
  input: AnalysisInferenceInput,
  defaultSystemPrompt: string | undefined,
): string {
  const system = input.systemPrompt ?? defaultSystemPrompt;
  if (system && system.trim().length > 0) {
    return `${system.trim()}\n\n${input.prompt}`;
  }
  return input.prompt;
}

async function readResponseLimited(
  response: Response,
  maxBytes: number,
): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (Number.isFinite(declared) && declared > maxBytes) {
      if (response.body) {
        await response.body.cancel().catch(() => undefined);
      }
      throw new AnalysisClientError(
        "ollama_unavailable",
        `Ollama response exceeds ${maxBytes} bytes`,
      );
    }
  }
  if (!response.body) {
    return "";
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AnalysisClientError(
          "ollama_unavailable",
          `Ollama response exceeds ${maxBytes} bytes`,
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof AnalysisClientError) throw error;
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  let text = "";
  for (const chunk of chunks) {
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return text;
}

/**
 * Create an Ollama analysis client (007.1C).
 * Injected via config; single concurrent inference; validates AnalysisProposalV1.
 */
export function createOllamaAnalysisClient(
  options: CreateOllamaAnalysisClientOptions,
): OllamaAnalysisClient {
  const maxConcurrency = options.config.maxConcurrency ?? OLLAMA_MAX_CONCURRENCY;
  if (maxConcurrency !== 1) {
    throw new Error("OLLAMA_MAX_CONCURRENCY must be 1");
  }

  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const sleep = options.sleep ?? defaultSleep;
  const inferenceTimeoutMs =
    options.inferenceTimeoutMs ?? OLLAMA_INFERENCE_TIMEOUT_MS;
  const queueTimeoutMs = options.queueTimeoutMs ?? OLLAMA_QUEUE_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? OLLAMA_MAX_ATTEMPTS;
  const retryDelaysMs = options.retryDelaysMs ?? OLLAMA_RETRY_DELAYS_MS;
  const maxResponseBytes =
    options.maxResponseBytes ?? OLLAMA_MAX_RESPONSE_BYTES;
  const slot = new InferenceSlot(queueTimeoutMs);
  const model = options.config.model;
  const generateUrl = joinUrl(options.config.baseUrl, "/api/generate");
  const acquireInferenceLease = options.acquireInferenceLease;

  async function runOnce(
    input: AnalysisInferenceInput,
  ): Promise<AnalysisInferenceResult> {
    const prompt = buildPromptBody(input, options.defaultSystemPrompt);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), inferenceTimeoutMs);
    const started = Date.now();

    try {
      let response: Response;
      try {
        response = await fetchImpl(generateUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            prompt,
            stream: false,
            format: "json",
          }),
          signal: controller.signal,
        });
      } catch (error) {
        const durationMs = Date.now() - started;
        if (isAbortError(error) || controller.signal.aborted) {
          return toFailure(
            "inference_timeout",
            `Ollama inference exceeded ${inferenceTimeoutMs}ms`,
            0,
            { cause: error, stage: "timeout", durationMs, retryable: true },
          );
        }
        return toFailure(
          "ollama_unavailable",
          "Ollama network request failed",
          0,
          { cause: error, stage: "transport", durationMs, retryable: true },
        );
      }

      if (!response.ok) {
        const durationMs = Date.now() - started;
        let bodyHint = "";
        try {
          bodyHint = (await response.text()).slice(0, 200);
        } catch {
          bodyHint = "";
        }
        const combined = `${response.statusText} ${bodyHint}`.trim();
        return toFailure(
          "ollama_unavailable",
          `Ollama HTTP ${response.status} ${combined}`.trim(),
          0,
          {
            stage: "http",
            statusCode: response.status,
            durationMs,
            retryable: response.status >= 500 || response.status === 429,
          },
        );
      }

      let rawBody: string;
      try {
        rawBody = await readResponseLimited(response, maxResponseBytes);
      } catch (error) {
        const durationMs = Date.now() - started;
        if (error instanceof AnalysisClientError) {
          return toFailure(error.code, error.message, 0, {
            cause: error,
            stage: "http",
            durationMs,
          });
        }
        return toFailure(
          "ollama_unavailable",
          "Ollama response body read failed",
          0,
          { cause: error, stage: "transport", durationMs },
        );
      }

      let payload: OllamaGenerateResponse;
      try {
        payload = JSON.parse(rawBody) as OllamaGenerateResponse;
      } catch (error) {
        return toFailure(
          "invalid_json",
          "Ollama response body is not valid JSON",
          0,
          {
            cause: error,
            rawText: rawBody,
            stage: "parse",
            durationMs: Date.now() - started,
          },
        );
      }

      if (typeof payload.error === "string" && payload.error.length > 0) {
        return toFailure("ollama_unavailable", payload.error, 0, {
          stage: "http",
          durationMs: Date.now() - started,
        });
      }

      const rawText =
        typeof payload.response === "string" ? payload.response : "";
      if (rawText.trim().length === 0) {
        return toFailure(
          "invalid_json",
          "Ollama response field is empty",
          0,
          {
            rawText,
            stage: "parse",
            durationMs: Date.now() - started,
            logErrorCode: "empty_response",
          },
        );
      }

      const validated = parseAnalysisProposalJson(rawText);
      if (!validated.ok) {
        return toFailure(validated.errorCode, validated.message, 0, {
          rawText,
          stage:
            validated.errorCode === "schema_violation" ||
            validated.errorCode === "empty_summary"
              ? "schema_validation"
              : "parse",
          durationMs: Date.now() - started,
        });
      }

      return {
        ok: true,
        proposal: validated.proposal,
        rawText,
        modelId:
          typeof payload.model === "string" && payload.model.length > 0
            ? payload.model
            : model,
        attempts: 0,
        durationMs: Date.now() - started,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    baseUrl: options.config.baseUrl,
    model,
    async infer(input) {
      let releaseLease: (() => Promise<void>) | undefined;
      if (acquireInferenceLease !== undefined) {
        try {
          releaseLease = await acquireInferenceLease();
        } catch (error) {
          return toFailure(
            "queue_timeout",
            error instanceof Error
              ? error.message
              : "failed to acquire inference lease",
            0,
            { cause: error, stage: "lease", retryable: true },
          );
        }
      }

      let release: (() => void) | undefined;
      try {
        release = await slot.acquire();
      } catch (error) {
        if (releaseLease) {
          await releaseLease().catch(() => undefined);
        }
        if (error instanceof AnalysisClientError && error.code === "queue_timeout") {
          return toFailure(error.code, error.message, 0, {
            cause: error,
            stage: "lease",
          });
        }
        throw error;
      }

      try {
        let lastFailure: AnalysisInferenceFailure | undefined;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          const result = await runOnce(input);
          if (result.ok) {
            return { ...result, attempts: attempt };
          }

          lastFailure = { ...result, attempts: attempt };
          const canRetry = attempt < maxAttempts && result.retryable;
          if (!canRetry) {
            break;
          }

          const delay = retryDelaysMs[attempt - 1] ?? retryDelaysMs[retryDelaysMs.length - 1]!;
          await sleep(delay);
        }

        return (
          lastFailure ??
          toFailure("ollama_unavailable", "inference failed without detail", maxAttempts)
        );
      } finally {
        release();
        if (releaseLease) {
          await releaseLease().catch(() => undefined);
        }
      }
    },
  };
}
