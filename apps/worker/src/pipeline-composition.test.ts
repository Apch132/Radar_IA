import { describe, expect, it, vi } from "vitest";

import { createConfig } from "@radar-ia/config";

import { createWorkerLogger } from "./logger.js";
import { buildPipelineRuntime } from "./pipeline-composition.js";

const BASE_ENV = {
  DATABASE_URL: "postgresql://radar:changeme@localhost:5432/radar_ia",
  OLLAMA_MODEL: "example-ministral-tag",
  PIPELINE_LOCK_TTL_MS: "120000",
  PIPELINE_HEARTBEAT_INTERVAL_MS: "15000",
  SOURCES_REGISTRY_PATH: "config/sources.json",
} as const;

describe("buildPipelineRuntime", () => {
  it("forwards lock TTL and heartbeat interval to the orchestrator", () => {
    const createOrchestrator = vi.fn(() => ({
      runCycle: vi.fn(),
    }));

    const prisma = {
      $disconnect: vi.fn(),
    };

    buildPipelineRuntime({
      config: createConfig({ ...BASE_ENV }),
      logger: createWorkerLogger("silent"),
      discord: null,
      prisma: prisma as never,
      createOrchestrator: createOrchestrator as never,
    });

    expect(createOrchestrator).toHaveBeenCalledTimes(1);
    const options = createOrchestrator.mock.calls[0]![1] as {
      lockTtlMs: number;
      heartbeatIntervalMs: number;
      isDiscordAvailable: () => boolean;
    };
    expect(options.lockTtlMs).toBe(120_000);
    expect(options.heartbeatIntervalMs).toBe(15_000);
    expect(options.isDiscordAvailable()).toBe(false);
  });
});
