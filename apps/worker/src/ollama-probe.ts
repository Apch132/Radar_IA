export type OllamaProbeFetch = (
  input: string | URL,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<
  Pick<Response, "ok" | "status" | "statusText" | "json" | "text">
>;

export type OllamaProbeStageResult = {
  readonly ok: boolean;
  readonly detail: string;
};

export type OllamaStartupDiagnostic = {
  readonly reachable: boolean;
  readonly modelPresent: boolean;
  readonly generationOk: boolean;
  readonly parseOk: boolean;
  readonly degradedMode: boolean;
  readonly model: string;
  readonly baseUrl: string;
  readonly stages: {
    readonly server: OllamaProbeStageResult;
    readonly model: OllamaProbeStageResult;
    readonly generation: OllamaProbeStageResult;
    readonly parse: OllamaProbeStageResult;
  };
};

export type ProbeOllamaOptions = {
  readonly baseUrl: string;
  readonly model: string;
  readonly fetch?: OllamaProbeFetch;
  readonly timeoutMs?: number;
  /** Skip generation probe (unit tests). */
  readonly skipGeneration?: boolean;
};

/**
 * Full Ollama startup diagnostic:
 * 1) server reachable via GET /api/tags
 * 2) configured model present
 * 3) minimal generation
 * 4) response parseable as JSON object
 *
 * Never blocks the worker permanently — caller decides degraded mode.
 */
export async function probeOllamaStartup(
  options: ProbeOllamaOptions,
): Promise<OllamaStartupDiagnostic> {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 8_000;
  const base = options.baseUrl.replace(/\/+$/, "");
  const model = options.model;

  const server = await probeServer(fetchImpl, base, timeoutMs);
  if (!server.ok) {
    return {
      reachable: false,
      modelPresent: false,
      generationOk: false,
      parseOk: false,
      degradedMode: true,
      model,
      baseUrl: base,
      stages: {
        server,
        model: { ok: false, detail: "skipped — server unreachable" },
        generation: { ok: false, detail: "skipped — server unreachable" },
        parse: { ok: false, detail: "skipped — server unreachable" },
      },
    };
  }

  const modelStage = await probeModelPresent(
    fetchImpl,
    base,
    model,
    timeoutMs,
  );
  if (!modelStage.ok) {
    return {
      reachable: true,
      modelPresent: false,
      generationOk: false,
      parseOk: false,
      degradedMode: true,
      model,
      baseUrl: base,
      stages: {
        server,
        model: modelStage,
        generation: { ok: false, detail: "skipped — model absent" },
        parse: { ok: false, detail: "skipped — model absent" },
      },
    };
  }

  if (options.skipGeneration) {
    return {
      reachable: true,
      modelPresent: true,
      generationOk: true,
      parseOk: true,
      degradedMode: false,
      model,
      baseUrl: base,
      stages: {
        server,
        model: modelStage,
        generation: { ok: true, detail: "skipped by option" },
        parse: { ok: true, detail: "skipped by option" },
      },
    };
  }

  const generation = await probeGeneration(fetchImpl, base, model, timeoutMs);
  return {
    reachable: true,
    modelPresent: true,
    generationOk: generation.generationOk,
    parseOk: generation.parseOk,
    degradedMode: !(generation.generationOk && generation.parseOk),
    model,
    baseUrl: base,
    stages: {
      server,
      model: modelStage,
      generation: generation.generation,
      parse: generation.parse,
    },
  };
}

/**
 * Lightweight reachability check (GET /api/tags). Kept for backward compatibility.
 */
export async function probeOllamaReachable(
  options: Omit<ProbeOllamaOptions, "model"> & { model?: string },
): Promise<{ reachable: boolean; detail: string }> {
  const diagnostic = await probeOllamaStartup({
    baseUrl: options.baseUrl,
    model: options.model ?? "",
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
    skipGeneration: true,
  });
  return {
    reachable: diagnostic.reachable,
    detail: diagnostic.stages.server.detail,
  };
}

async function probeServer(
  fetchImpl: OllamaProbeFetch,
  base: string,
  timeoutMs: number,
): Promise<OllamaProbeStageResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${base}/api/tags`, {
      method: "GET",
      signal: controller.signal,
    });
    if (response.ok) {
      return { ok: true, detail: `HTTP ${response.status}` };
    }
    return { ok: false, detail: `HTTP ${response.status}` };
  } catch (error) {
    return { ok: false, detail: formatError(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function probeModelPresent(
  fetchImpl: OllamaProbeFetch,
  base: string,
  model: string,
  timeoutMs: number,
): Promise<OllamaProbeStageResult> {
  if (model.trim() === "") {
    return { ok: false, detail: "OLLAMA_MODEL empty" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${base}/api/tags`, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, detail: `HTTP ${response.status}` };
    }
    const payload = (await response.json()) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    const names = (payload.models ?? [])
      .map((entry) => entry.name ?? entry.model ?? "")
      .filter((name) => name.length > 0);
    const present = names.some(
      (name) => name === model || name.startsWith(`${model}:`) || model.startsWith(name),
    );
    if (present) {
      return { ok: true, detail: `model present (${names.length} listed)` };
    }
    return {
      ok: false,
      detail: `model "${model}" absent from /api/tags`,
    };
  } catch (error) {
    return { ok: false, detail: formatError(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function probeGeneration(
  fetchImpl: OllamaProbeFetch,
  base: string,
  model: string,
  timeoutMs: number,
): Promise<{
  generationOk: boolean;
  parseOk: boolean;
  generation: OllamaProbeStageResult;
  parse: OllamaProbeStageResult;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt:
          'Reply with a single JSON object: {"schemaVersion":"1","ok":true}',
        stream: false,
        format: "json",
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        generationOk: false,
        parseOk: false,
        generation: {
          ok: false,
          detail: `HTTP ${response.status} ${body.slice(0, 120)}`.trim(),
        },
        parse: { ok: false, detail: "skipped — generation failed" },
      };
    }
    const payload = (await response.json()) as {
      response?: string;
      error?: string;
    };
    if (typeof payload.error === "string" && payload.error.length > 0) {
      return {
        generationOk: false,
        parseOk: false,
        generation: { ok: false, detail: payload.error.slice(0, 160) },
        parse: { ok: false, detail: "skipped — generation error" },
      };
    }
    const raw =
      typeof payload.response === "string" ? payload.response.trim() : "";
    if (raw.length === 0) {
      return {
        generationOk: false,
        parseOk: false,
        generation: { ok: false, detail: "empty response field" },
        parse: { ok: false, detail: "empty response field" },
      };
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return {
          generationOk: true,
          parseOk: false,
          generation: { ok: true, detail: "generation returned text" },
          parse: { ok: false, detail: "JSON is not an object" },
        };
      }
      return {
        generationOk: true,
        parseOk: true,
        generation: { ok: true, detail: "generation ok" },
        parse: { ok: true, detail: "JSON object parsed" },
      };
    } catch (error) {
      return {
        generationOk: true,
        parseOk: false,
        generation: { ok: true, detail: "generation returned text" },
        parse: { ok: false, detail: formatError(error) },
      };
    }
  } catch (error) {
    return {
      generationOk: false,
      parseOk: false,
      generation: { ok: false, detail: formatError(error) },
      parse: { ok: false, detail: "skipped — generation failed" },
    };
  } finally {
    clearTimeout(timer);
  }
}

function formatError(error: unknown): string {
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  return `${name}: ${message.slice(0, 120)}`;
}
