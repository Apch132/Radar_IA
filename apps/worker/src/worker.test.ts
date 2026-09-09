import { isAbsolute, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  createConfig,
  ConfigurationError,
  findMonorepoRoot,
} from "@radar-ia/config";
import type { PipelineCycleResult } from "@radar-ia/database";
import { GatewayIntentBits } from "discord.js";

import {
  createWorkerDiscordClient,
  createWorkerDiscordHandle,
  WORKER_DISCORD_INTENTS,
} from "./discord-runtime.js";
import { createHolderId, HOLDER_ID_MAX_LENGTH } from "./holder-id.js";
import { createWorkerLogger } from "./logger.js";
import { probeOllamaReachable } from "./ollama-probe.js";
import { createCycleScheduler, type SchedulerTimers } from "./scheduler.js";
import { startWorker } from "./worker.js";

const BASE_ENV = {
  DATABASE_URL: "postgresql://radar:changeme@localhost:5432/radar_ia",
  OLLAMA_MODEL: "example-ministral-tag",
} as const;

function emptyCounters() {
  return {
    sources: {
      total: 0,
      enabled: 0,
      collected: 0,
      notModified: 0,
      skippedDisabled: 0,
      skippedBackoff: 0,
      failed: 0,
    },
    articles: {
      normalized: 0,
      rejected: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
    },
    matching: {
      create_dossier: 0,
      attach_enrich: 0,
      duplicate_editorial: 0,
      ambiguous_no_action: 0,
      failed: 0,
      skipped: 0,
    },
    analysis: {
      analyzed: 0,
      reused: 0,
      skipped: 0,
      failed: 0,
    },
    publication: {
      published: 0,
      enriched: 0,
      resumed: 0,
      skipped: 0,
      failed: 0,
      deferred: 0,
    },
  };
}

function cycleResult(
  overrides: Partial<PipelineCycleResult> = {},
): PipelineCycleResult {
  const counters = emptyCounters();
  const status = overrides.status ?? "completed";
  return {
    runId: "run-1",
    status,
    trigger: "scheduled",
    startedAt: new Date("2026-07-16T22:00:00.000Z"),
    finishedAt: new Date("2026-07-16T22:01:00.000Z"),
    lockAcquired: true,
    lockStolen: false,
    rejectionCode: null,
    degraded: status === "degraded",
    ...counters,
    errors: [],
    summary: {
      version: 1,
      degraded: status === "degraded",
      rejectionCode: null,
      ...counters,
      errorCodes: [],
    },
    ...overrides,
  };
}

function createFakeTimers(): {
  timers: SchedulerTimers;
  flush(ms?: number): Promise<void>;
  pendingCount(): number;
} {
  type Entry = { due: number; handler: () => void; cleared: boolean };
  let now = 0;
  const entries: Entry[] = [];

  return {
    timers: {
      setTimeout(handler, ms) {
        const entry: Entry = { due: now + ms, handler, cleared: false };
        entries.push(entry);
        return {
          clear() {
            entry.cleared = true;
          },
        };
      },
    },
    pendingCount() {
      return entries.filter((entry) => !entry.cleared).length;
    },
    async flush(advanceMs = 0) {
      now += advanceMs;
      const due = entries
        .filter((entry) => !entry.cleared && entry.due <= now)
        .sort((a, b) => a.due - b.due);
      for (const entry of due) {
        entry.cleared = true;
        entry.handler();
        await Promise.resolve();
        await Promise.resolve();
      }
    },
  };
}

function mockPrisma() {
  return {
    $disconnect: vi.fn(async () => undefined),
  };
}

describe("worker config (via @radar-ia/config)", () => {
  it("accepts worker defaults", () => {
    const config = createConfig({ ...BASE_ENV });
    expect(isAbsolute(config.sources.registryPath)).toBe(true);
    expect(config.sources.registryPath).toBe(
      resolve(findMonorepoRoot(), "config/sources.json"),
    );
    expect(config.worker.schedulerEnabled).toBe(true);
    expect(config.worker.cycleIntervalMs).toBe(15 * 60_000);
    expect(config.worker.initialDelayMs).toBe(5_000);
    expect(config.worker.lockTtlMs).toBe(5 * 60_000);
    expect(config.worker.heartbeatIntervalMs).toBe(30_000);
    expect(config.worker.holderPrefix).toBe("worker");
  });

  it("parses worker overrides", () => {
    const config = createConfig({
      ...BASE_ENV,
      SOURCES_REGISTRY_PATH: "config/custom-sources.json",
      WORKER_SCHEDULER_ENABLED: "false",
      WORKER_CYCLE_INTERVAL_MS: "60000",
      WORKER_INITIAL_DELAY_MS: "0",
      PIPELINE_LOCK_TTL_MS: "120000",
      PIPELINE_HEARTBEAT_INTERVAL_MS: "10000",
      WORKER_HOLDER_PREFIX: "radar-worker",
    });
    expect(config.sources.registryPath).toBe(
      resolve(findMonorepoRoot(), "config/custom-sources.json"),
    );
    expect(config.worker.schedulerEnabled).toBe(false);
    expect(config.worker.cycleIntervalMs).toBe(60_000);
    expect(config.worker.initialDelayMs).toBe(0);
    expect(config.worker.lockTtlMs).toBe(120_000);
    expect(config.worker.heartbeatIntervalMs).toBe(10_000);
    expect(config.worker.holderPrefix).toBe("radar-worker");
  });

  it("rejects invalid worker config without leaking secrets", () => {
    const secret = "super-secret-db-password-ZZZ";
    try {
      createConfig({
        DATABASE_URL: `postgresql://radar:${secret}@localhost:5432/radar_ia`,
        OLLAMA_MODEL: BASE_ENV.OLLAMA_MODEL,
        WORKER_CYCLE_INTERVAL_MS: "not-a-number",
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigurationError);
      const message = String(error);
      expect(message).not.toContain(secret);
      expect(message).toContain("WORKER_CYCLE_INTERVAL_MS");
    }
  });
});

describe("createHolderId", () => {
  it("builds a bounded holder id", () => {
    const id = createHolderId({
      prefix: "worker",
      host: "host-a",
      pid: 4242,
      randomSuffix: "abc123",
    });
    expect(id).toBe("worker:host-a:4242:abc123");
    expect(id.length).toBeLessThanOrEqual(HOLDER_ID_MAX_LENGTH);
  });

  it("is stable for identical inputs", () => {
    const a = createHolderId({
      prefix: "worker",
      host: "h",
      pid: 1,
      randomSuffix: "deadbe",
    });
    const b = createHolderId({
      prefix: "worker",
      host: "h",
      pid: 1,
      randomSuffix: "deadbe",
    });
    expect(a).toBe(b);
  });

  it("contains no secrets", () => {
    const id = createHolderId({
      prefix: "worker",
      host: "box",
      pid: 9,
      randomSuffix: "ff00aa",
    });
    expect(id).not.toMatch(/token|password|postgresql/i);
  });
});

describe("createCycleScheduler", () => {
  it("runs the first cycle after the initial delay", async () => {
    const fake = createFakeTimers();
    const runCycle = vi.fn(async () => undefined);
    const scheduler = createCycleScheduler({
      initialDelayMs: 100,
      intervalMs: 1_000,
      schedulerEnabled: true,
      runCycle,
      timers: fake.timers,
    });
    scheduler.start();
    expect(runCycle).not.toHaveBeenCalled();
    await fake.flush(100);
    expect(runCycle).toHaveBeenCalledTimes(1);
    scheduler.stop();
  });

  it("schedules the next cycle after completion (no overlap)", async () => {
    const fake = createFakeTimers();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runCycle = vi.fn(async () => gate);
    const scheduler = createCycleScheduler({
      initialDelayMs: 0,
      intervalMs: 50,
      schedulerEnabled: true,
      runCycle,
      timers: fake.timers,
    });
    scheduler.start();
    await fake.flush(0);
    expect(scheduler.isTickActive).toBe(true);
    expect(runCycle).toHaveBeenCalledTimes(1);
    // Missed tick while active — no second invocation.
    await fake.flush(50);
    expect(runCycle).toHaveBeenCalledTimes(1);
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(scheduler.isTickActive).toBe(false);
    await fake.flush(50);
    expect(runCycle).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("one-shot: scheduler disabled runs a single cycle", async () => {
    const fake = createFakeTimers();
    const runCycle = vi.fn(async () => undefined);
    const scheduler = createCycleScheduler({
      initialDelayMs: 0,
      intervalMs: 10,
      schedulerEnabled: false,
      runCycle,
      timers: fake.timers,
    });
    scheduler.start();
    await fake.flush(0);
    expect(runCycle).toHaveBeenCalledTimes(1);
    await fake.flush(100);
    expect(runCycle).toHaveBeenCalledTimes(1);
    expect(scheduler.isStopped).toBe(true);
  });

  it("keeps scheduling after a cycle error", async () => {
    const fake = createFakeTimers();
    const onError = vi.fn();
    const runCycle = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(undefined);
    const scheduler = createCycleScheduler({
      initialDelayMs: 0,
      intervalMs: 20,
      schedulerEnabled: true,
      runCycle,
      onError,
      timers: fake.timers,
    });
    scheduler.start();
    await fake.flush(0);
    expect(onError).toHaveBeenCalledTimes(1);
    await fake.flush(20);
    expect(runCycle).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("does not burst after a missed tick", async () => {
    const fake = createFakeTimers();
    const runCycle = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    const scheduler = createCycleScheduler({
      initialDelayMs: 0,
      intervalMs: 10,
      schedulerEnabled: true,
      runCycle,
      timers: fake.timers,
    });
    scheduler.start();
    await fake.flush(0);
    await fake.flush(100);
    // Only one in-flight; next schedules after completion, not N catch-ups.
    expect(runCycle.mock.calls.length).toBeLessThanOrEqual(2);
    scheduler.stop();
  });
});

describe("startWorker", () => {
  it("constructs a worker and runs the first cycle", async () => {
    const fake = createFakeTimers();
    const runCycle = vi.fn(async () => cycleResult({ status: "completed" }));
    const disconnect = vi.fn(async () => undefined);
    const logs: string[] = [];
    const logger = {
      info: (message: string) => {
        logs.push(message);
      },
      warn: (message: string) => {
        logs.push(`warn:${message}`);
      },
      error: (message: string) => {
        logs.push(`error:${message}`);
      },
    };

    const handle = await startWorker({
      config: createConfig({
        ...BASE_ENV,
        WORKER_INITIAL_DELAY_MS: "0",
        WORKER_SCHEDULER_ENABLED: "false",
      }),
      logger,
      holderId: "worker:test:1:aabbcc",
      registerSignals: false,
      skipDiscordLogin: true,
      skipOllamaProbe: true,
      discord: null,
      timers: fake.timers,
      exitProcess: false,
      buildRuntime: () => ({
        prisma: { $disconnect: disconnect } as never,
        orchestrator: { runCycle } as never,
        runCycle,
      }),
    });

    expect(handle.holderId).toBe("worker:test:1:aabbcc");
    expect(logs.some((line) => line.includes("Worker ready"))).toBe(true);
    await fake.flush(0);
    expect(runCycle).toHaveBeenCalledWith({
      holderId: "worker:test:1:aabbcc",
      trigger: "scheduled",
    });
    expect(logs.some((line) => line.includes("completed"))).toBe(true);

    await handle.shutdown();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("logs concurrent lock refusal and continues", async () => {
    const fake = createFakeTimers();
    const runCycle = vi.fn(async () =>
      cycleResult({
        runId: null,
        status: null,
        lockAcquired: false,
        rejectionCode: "concurrent_lock",
      }),
    );
    const logs: string[] = [];
    const handle = await startWorker({
      config: createConfig({
        ...BASE_ENV,
        WORKER_INITIAL_DELAY_MS: "0",
        WORKER_SCHEDULER_ENABLED: "false",
      }),
      logger: {
        info: (m) => logs.push(m),
        warn: (m) => logs.push(m),
        error: (m) => logs.push(m),
      },
      registerSignals: false,
      skipDiscordLogin: true,
      skipOllamaProbe: true,
      discord: null,
      timers: fake.timers,
      exitProcess: false,
      buildRuntime: () => ({
        prisma: mockPrisma() as never,
        orchestrator: { runCycle } as never,
        runCycle,
      }),
    });
    await fake.flush(0);
    expect(logs.some((line) => line.includes("concurrent"))).toBe(true);
    await handle.shutdown();
  });

  it("logs degraded and failed cycles without stopping", async () => {
    const fake = createFakeTimers();
    const runCycle = vi
      .fn()
      .mockResolvedValueOnce(cycleResult({ status: "degraded", degraded: true }))
      .mockResolvedValueOnce(cycleResult({ status: "failed" }))
      .mockResolvedValue(cycleResult({ status: "completed" }));
    const logs: string[] = [];
    const handle = await startWorker({
      config: createConfig({
        ...BASE_ENV,
        WORKER_INITIAL_DELAY_MS: "0",
        WORKER_CYCLE_INTERVAL_MS: "10",
        WORKER_SCHEDULER_ENABLED: "true",
      }),
      logger: {
        info: (m) => logs.push(m),
        warn: (m) => logs.push(m),
        error: (m) => logs.push(m),
      },
      registerSignals: false,
      skipDiscordLogin: true,
      skipOllamaProbe: true,
      discord: null,
      timers: fake.timers,
      exitProcess: false,
      buildRuntime: () => ({
        prisma: mockPrisma() as never,
        orchestrator: { runCycle } as never,
        runCycle,
      }),
    });
    await fake.flush(0);
    await fake.flush(10);
    await fake.flush(10);
    expect(logs.some((line) => line.includes("degraded"))).toBe(true);
    expect(logs.some((line) => line.includes("failed"))).toBe(true);
    expect(runCycle.mock.calls.length).toBeGreaterThanOrEqual(2);
    await handle.shutdown();
  });

  it("survives a thrown cycle and schedules the next", async () => {
    const fake = createFakeTimers();
    const runCycle = vi
      .fn()
      .mockRejectedValueOnce(new Error("cycle boom"))
      .mockResolvedValueOnce(cycleResult());
    const logs: string[] = [];
    const handle = await startWorker({
      config: createConfig({
        ...BASE_ENV,
        WORKER_INITIAL_DELAY_MS: "0",
        WORKER_CYCLE_INTERVAL_MS: "5",
      }),
      logger: {
        info: (m) => logs.push(m),
        warn: (m) => logs.push(m),
        error: (m) => logs.push(m),
      },
      registerSignals: false,
      skipDiscordLogin: true,
      skipOllamaProbe: true,
      discord: null,
      timers: fake.timers,
      exitProcess: false,
      buildRuntime: () => ({
        prisma: mockPrisma() as never,
        orchestrator: { runCycle } as never,
        runCycle,
      }),
    });
    await fake.flush(0);
    expect(logs.some((line) => line.includes("threw"))).toBe(true);
    await fake.flush(5);
    expect(runCycle).toHaveBeenCalledTimes(2);
    await handle.shutdown();
  });

  it("double shutdown closes Prisma / Discord once", async () => {
    const destroy = vi.fn();
    const disconnect = vi.fn(async () => undefined);
    const fake = createFakeTimers();
    const discord = {
      client: {} as never,
      isReady: () => false,
      login: vi.fn(async () => undefined),
      destroy,
    };
    const handle = await startWorker({
      config: createConfig({
        ...BASE_ENV,
        WORKER_SCHEDULER_ENABLED: "false",
        WORKER_INITIAL_DELAY_MS: "1000",
      }),
      logger: createWorkerLogger("silent"),
      registerSignals: false,
      skipDiscordLogin: true,
      skipOllamaProbe: true,
      discord,
      timers: fake.timers,
      exitProcess: false,
      buildRuntime: () => ({
        prisma: { $disconnect: disconnect } as never,
        orchestrator: { runCycle: vi.fn() } as never,
        runCycle: vi.fn(async () => cycleResult()),
      }),
    });
    await handle.shutdown("SIGINT");
    await handle.shutdown("SIGTERM");
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("warns when Ollama is unreachable and stays alive", async () => {
    const fake = createFakeTimers();
    const logs: string[] = [];
    const handle = await startWorker({
      config: createConfig({
        ...BASE_ENV,
        WORKER_SCHEDULER_ENABLED: "false",
        WORKER_INITIAL_DELAY_MS: "1000",
      }),
      logger: {
        info: (m) => logs.push(m),
        warn: (m) => logs.push(m),
        error: (m) => logs.push(m),
      },
      registerSignals: false,
      skipDiscordLogin: true,
      discord: null,
      timers: fake.timers,
      exitProcess: false,
      ollamaFetch: async () => {
        throw new Error("ECONNREFUSED");
      },
      buildRuntime: () => ({
        prisma: mockPrisma() as never,
        orchestrator: { runCycle: vi.fn() } as never,
        runCycle: vi.fn(async () => cycleResult()),
      }),
    });
    expect(
      logs.some(
        (line) =>
          line.includes("Ollama degraded") ||
          line.includes("Ollama startup diagnostic"),
      ),
    ).toBe(true);
    expect(handle.scheduler.isStopped).toBe(false);
    await handle.shutdown();
  });

  it("keeps running when Discord is unavailable", async () => {
    const fake = createFakeTimers();
    const runCycle = vi.fn(async () =>
      cycleResult({
        status: "degraded",
        degraded: true,
        errors: [
          {
            code: "discord_unavailable",
            message: "Discord unavailable — publication deferred",
          },
        ],
      }),
    );
    const logs: string[] = [];
    const handle = await startWorker({
      config: createConfig({
        ...BASE_ENV,
        WORKER_INITIAL_DELAY_MS: "0",
        WORKER_SCHEDULER_ENABLED: "false",
      }),
      logger: {
        info: (m) => logs.push(m),
        warn: (m) => logs.push(m),
        error: (m) => logs.push(m),
      },
      registerSignals: false,
      skipDiscordLogin: true,
      skipOllamaProbe: true,
      discord: null,
      timers: fake.timers,
      exitProcess: false,
      buildRuntime: () => ({
        prisma: mockPrisma() as never,
        orchestrator: { runCycle } as never,
        runCycle,
      }),
    });
    await fake.flush(0);
    expect(logs.some((line) => line.includes("degraded"))).toBe(true);
    await handle.shutdown();
  });
});

describe("Discord worker client", () => {
  it("uses gelled intents only", () => {
    expect(WORKER_DISCORD_INTENTS).toEqual([
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
    ]);
    expect(WORKER_DISCORD_INTENTS).not.toContain(
      GatewayIntentBits.MessageContent,
    );
    const client = createWorkerDiscordClient();
    expect(client.options.intents).toBeDefined();
    client.destroy();
  });

  it("destroy is idempotent", () => {
    const handle = createWorkerDiscordHandle({
      once: vi.fn(),
      login: vi.fn(),
      destroy: vi.fn(),
    } as never);
    handle.destroy();
    handle.destroy();
    expect(handle.isReady()).toBe(false);
  });
});

describe("probeOllamaReachable", () => {
  it("reports reachable on HTTP 200", async () => {
    const result = await probeOllamaReachable({
      baseUrl: "http://ollama.local",
      fetch: async () => ({ ok: true, status: 200 }),
    });
    expect(result.reachable).toBe(true);
  });

  it("reports unreachable without throwing", async () => {
    const result = await probeOllamaReachable({
      baseUrl: "http://ollama.local",
      fetch: async () => {
        throw new Error("network down");
      },
    });
    expect(result.reachable).toBe(false);
    expect(result.detail).toContain("network down");
  });
});

describe("worker boundaries", () => {
  it("does not register slash commands in the Discord client factory", () => {
    const source = createWorkerDiscordClient.toString();
    expect(source).not.toMatch(/slash|applicationCommand|REST/i);
  });
});
