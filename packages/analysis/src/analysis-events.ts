import type { AnalysisFailureDetail } from "./analysis-service-types.js";

export type AnalysisFailedEvent = {
  readonly event: "analysis.failed";
  readonly dossierId: string;
  readonly articleIds: readonly string[];
  readonly sourceIds: readonly string[];
  readonly model: string;
  readonly ollamaBaseUrl: string;
  readonly stage: AnalysisFailureDetail["stage"];
  readonly statusCode: number;
  readonly errorCode: string;
  readonly message: string;
  readonly durationMs: number;
  readonly retryable: boolean;
  readonly attemptNumber: number;
};

export type AnalysisSucceededEvent = {
  readonly event: "analysis.succeeded";
  readonly dossierId: string;
  readonly articleCount: number;
  readonly model: string;
  readonly durationMs: number;
  readonly decision: string;
  readonly decisionMethod: "llm_analysis" | "deterministic_fallback";
  readonly channelHint: string | null;
  readonly attemptNumber: number;
};

export function buildAnalysisFailedEvent(input: {
  dossierId: string;
  articleIds: readonly string[];
  sourceIds: readonly string[];
  model: string;
  ollamaBaseUrl: string;
  detail: AnalysisFailureDetail;
}): AnalysisFailedEvent {
  return {
    event: "analysis.failed",
    dossierId: input.dossierId,
    articleIds: [...input.articleIds],
    sourceIds: [...input.sourceIds],
    model: input.model,
    ollamaBaseUrl: input.ollamaBaseUrl,
    stage: input.detail.stage,
    statusCode: input.detail.statusCode ?? 0,
    errorCode: input.detail.errorCode,
    message: input.detail.message.slice(0, 500),
    durationMs: input.detail.durationMs,
    retryable: input.detail.retryable,
    attemptNumber: input.detail.attemptNumber,
  };
}

export function buildAnalysisSucceededEvent(input: {
  dossierId: string;
  articleCount: number;
  model: string;
  durationMs: number;
  decision: string;
  decisionMethod: "llm_analysis" | "deterministic_fallback";
  channelHint: string | null;
  attemptNumber: number;
}): AnalysisSucceededEvent {
  return {
    event: "analysis.succeeded",
    dossierId: input.dossierId,
    articleCount: input.articleCount,
    model: input.model,
    durationMs: input.durationMs,
    decision: input.decision,
    decisionMethod: input.decisionMethod,
    channelHint: input.channelHint,
    attemptNumber: input.attemptNumber,
  };
}

export function mapInferenceErrorToLogCode(input: {
  errorCode: string;
  message: string;
  statusCode?: number;
  stage?: string;
}): string {
  const message = input.message.toLowerCase();
  if (
    message.includes("model") &&
    (message.includes("not found") ||
      message.includes("does not exist") ||
      message.includes("pull"))
  ) {
    return "model_absent";
  }
  if (input.stage === "timeout" || input.errorCode === "inference_timeout") {
    return "timeout";
  }
  if (input.stage === "transport" || input.errorCode === "ollama_unavailable") {
    if (input.statusCode !== undefined && input.statusCode >= 400) {
      return "http_error";
    }
    return "server_unreachable";
  }
  if (input.errorCode === "queue_timeout") {
    return "lease_or_queue_timeout";
  }
  if (input.errorCode === "invalid_json") {
    if (message.includes("empty")) {
      return "empty_response";
    }
    return "invalid_json";
  }
  if (input.errorCode === "schema_violation" || input.errorCode === "empty_summary") {
    return "schema_validation";
  }
  return input.errorCode;
}
