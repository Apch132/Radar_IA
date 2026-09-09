import {
  config as defaultConfig,
  type Config,
} from "@radar-ia/config";
import type { PipelineCycleResult } from "@radar-ia/database";

import {
  createWorkerDiscordHandle,
  type WorkerDiscordHandle,
} from "./discord-runtime.js";
import { createHolderId } from "./holder-id.js";
import { createWorkerLogger, type WorkerLogger } from "./logger.js";
import {
  probeOllamaReachable,
  probeOllamaStartup,
  type OllamaProbeFetch,
} from "./ollama-probe.js";
import {
  buildPipelineRuntime,
  type PipelineRuntime,
} from "./pipeline-composition.js";
import {
  createCycleScheduler,
  type CycleScheduler,
  type SchedulerTimers,
} from "./scheduler.js";

export type StartWorkerOptions = {
  readonly config?: Config;
  readonly logger?: WorkerLogger;
  readonly holderId?: string;
  readonly registerSignals?: boolean;
  readonly discord?: WorkerDiscordHandle | null;
  /** Skip Discord login even when token is set (tests). */
  readonly skipDiscordLogin?: boolean;
  /** Skip Ollama probe (tests). */
  readonly skipOllamaProbe?: boolean;
  readonly ollamaFetch?: OllamaProbeFetch;
  readonly timers?: SchedulerTimers;
  readonly buildRuntime?: (input: {
    config: Config;
    logger: WorkerLogger;
    discord: WorkerDiscordHandle | null;
  }) => PipelineRuntime;
  /** When set, process.exit is not called (tests). */
  readonly exitProcess?: boolean;
};

export type WorkerHandle = {
  readonly holderId: string;
  readonly scheduler: CycleScheduler;
  shutdown: (signal?: NodeJS.Signals) => Promise<void>;
};

function summarizeCycle(result: PipelineCycleResult): Record<string, unknown> {
  return {
    runId: result.runId,
    status: result.status,
    lockAcquired: result.lockAcquired,
    lockStolen: result.lockStolen,
    rejectionCode: result.rejectionCode,
    degraded: result.degraded,
    sources: result.sources,
    articles: result.articles,
    matching: result.matching,
    analysis: result.analysis,
    publication: result.publication,
    errorCodes: result.errors.map((error) => error.code),
    errors: result.errors.slice(0, 20).map((error) => ({
      code: error.code,
      message: error.message,
      ...(error.sourceId !== undefined ? { sourceId: error.sourceId } : {}),
      ...(error.folderId !== undefined ? { folderId: error.folderId } : {}),
      ...(error.articleId !== undefined ? { articleId: error.articleId } : {}),
      ...(error.stage !== undefined ? { stage: error.stage } : {}),
      ...(error.statusCode !== undefined
        ? { statusCode: error.statusCode }
        : {}),
      ...(error.errorCode !== undefined ? { errorCode: error.errorCode } : {}),
      ...(error.retryable !== undefined ? { retryable: error.retryable } : {}),
      ...(error.attemptNumber !== undefined
        ? { attemptNumber: error.attemptNumber }
        : {}),
      ...(error.durationMs !== undefined
        ? { durationMs: error.durationMs }
        : {}),
      ...(error.model !== undefined ? { model: error.model } : {}),
    })),
  };
}

function registerSignalHandlers(
  shutdown: (signal: NodeJS.Signals) => Promise<void>,
  exitProcess: boolean,
): void {
  const onSignal = (signal: NodeJS.Signals) => {
    void shutdown(signal).then(
      () => {
        if (exitProcess) {
          process.exit(0);
        }
      },
      () => {
        if (exitProcess) {
          process.exit(1);
        }
      },
    );
  };
  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("SIGTERM", () => onSignal("SIGTERM"));
}

/**
 * Start the dedicated pipeline worker: compose runtime, probe deps, schedule cycles.
 */
export async function startWorker(
  options: StartWorkerOptions = {},
): Promise<WorkerHandle> {
  const config = options.config ?? defaultConfig;
  const logger = options.logger ?? createWorkerLogger(config.app.logLevel);
  const exitProcess = options.exitProcess !== false;
  const holderId =
    options.holderId ??
    createHolderId({ prefix: config.worker.holderPrefix });

  let discord: WorkerDiscordHandle | null =
    options.discord === undefined
      ? config.discord.token !== undefined
        ? createWorkerDiscordHandle()
        : null
      : options.discord;

  if (
    discord !== null &&
    config.discord.token !== undefined &&
    options.skipDiscordLogin !== true
  ) {
    try {
      await discord.login(config.discord.token);
    } catch (error) {
      const detail =
        error instanceof Error ? error.message.slice(0, 160) : String(error);
      logger.warn("Discord login failed — worker continues without publication", {
        detail,
      });
      discord.destroy();
      discord = null;
    }
  } else if (config.discord.token === undefined) {
    logger.warn(
      "DISCORD_TOKEN unset — worker runs without Discord publication",
    );
  }

  if (options.skipOllamaProbe !== true) {
    const diagnostic = await probeOllamaStartup({
      baseUrl: config.ollama.baseUrl,
      model: config.ollama.model,
      fetch: options.ollamaFetch,
    });
    logger.info("Ollama startup diagnostic", {
      event: "ollama.startup_diagnostic",
      reachable: diagnostic.reachable,
      modelPresent: diagnostic.modelPresent,
      generationOk: diagnostic.generationOk,
      parseOk: diagnostic.parseOk,
      degradedMode: diagnostic.degradedMode,
      model: diagnostic.model,
      baseUrl: diagnostic.baseUrl,
      stages: diagnostic.stages,
    });
    if (diagnostic.degradedMode) {
      logger.warn(
        "Ollama degraded at startup — collector continues; deterministic fallback enabled for major Tier-S announcements",
        {
          event: "ollama.degraded_mode",
          detail: diagnostic.stages,
        },
      );
    }
  }

  const runtime = (options.buildRuntime ??
    ((input) =>
      buildPipelineRuntime({
        config: input.config,
        logger: input.logger,
        discord: input.discord,
      })))({
    config,
    logger,
    discord,
  });

  let shuttingDown = false;
  let activeCycle: Promise<void> | undefined;

  async function executeCycle(): Promise<void> {
    logger.info("Pipeline cycle started", {
      holderId,
      trigger: "scheduled",
    });

    let result: PipelineCycleResult;
    try {
      result = await runtime.runCycle({
        holderId,
        trigger: "scheduled",
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 200) : String(error);
      logger.error("Pipeline cycle threw — worker continues", { message });
      return;
    }

    if (!result.lockAcquired && result.rejectionCode === "concurrent_lock") {
      logger.info("Pipeline cycle refused (concurrent lock)", summarizeCycle(result));
      return;
    }

    if (result.lockStolen) {
      logger.warn("Pipeline lock stolen from expired holder", {
        runId: result.runId,
      });
    }

    const status = result.status ?? "none";
    logger.info(`Pipeline cycle finished (${status})`, summarizeCycle(result));
  }

  async function shutdown(signal?: NodeJS.Signals): Promise<void> {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    logger.info("Worker shutting down", {
      ...(signal !== undefined ? { signal } : {}),
    });

    scheduler.stop();

    if (activeCycle !== undefined) {
      try {
        await activeCycle;
      } catch {
        // Already logged inside executeCycle / scheduler.
      }
    }

    try {
      discord?.destroy();
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 160) : String(error);
      logger.warn("Discord destroy error during shutdown", { message });
    }

    try {
      await runtime.prisma.$disconnect();
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 160) : String(error);
      logger.warn("Prisma disconnect error during shutdown", { message });
    }

    logger.info("Worker shutdown complete");

    if (exitProcess && signal !== undefined) {
      // Signal path exits via registerSignalHandlers.
    }
  }

  const scheduler = createCycleScheduler({
    initialDelayMs: config.worker.initialDelayMs,
    intervalMs: config.worker.cycleIntervalMs,
    schedulerEnabled: config.worker.schedulerEnabled,
    timers: options.timers,
    runCycle: async () => {
      const cycle = executeCycle();
      activeCycle = cycle;
      try {
        await cycle;
      } finally {
        if (activeCycle === cycle) {
          activeCycle = undefined;
        }
      }
      if (!config.worker.schedulerEnabled && !shuttingDown) {
        await shutdown();
        if (exitProcess) {
          process.exit(0);
        }
      }
    },
    onError: (error) => {
      const message =
        error instanceof Error ? error.message.slice(0, 200) : String(error);
      logger.error("Scheduler tick error", { message });
    },
  });

  if (options.registerSignals !== false) {
    registerSignalHandlers(shutdown, exitProcess);
  }

  logger.info("Worker ready", {
    holderId,
    schedulerEnabled: config.worker.schedulerEnabled,
    cycleIntervalMs: config.worker.cycleIntervalMs,
    initialDelayMs: config.worker.initialDelayMs,
    mode: config.worker.schedulerEnabled ? "scheduled" : "one-shot",
  });

  scheduler.start();

  return { holderId, scheduler, shutdown };
}
