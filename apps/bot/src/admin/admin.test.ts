import { describe, expect, it, vi } from "vitest";
import { createConfig } from "@radar-ia/config";
import { MessageFlags } from "discord.js";

import { isAllowlistedAdmin } from "./allowlist.js";
import { ADMIN_COMMAND_NAME, buildAdminSlashCommandBodies } from "./commands.js";
import {
  formatForbidden,
  formatHealthDashboard,
  formatPipelineStatus,
  formatSourcesStatus,
} from "./format.js";
import { createBotHolderId } from "./holder-id.js";
import { registerAdminInteractions } from "./handlers.js";

const ADMIN_ID = "123456789012345678";
const OTHER_ID = "223456789012345678";

describe("isAllowlistedAdmin", () => {
  it("accepts only configured user IDs", () => {
    expect(isAllowlistedAdmin(ADMIN_ID, [ADMIN_ID])).toBe(true);
    expect(isAllowlistedAdmin(OTHER_ID, [ADMIN_ID])).toBe(false);
    expect(isAllowlistedAdmin("", [ADMIN_ID])).toBe(false);
  });
});

describe("buildAdminSlashCommandBodies", () => {
  it("exposes radar-admin subcommands for 009.1E surface", () => {
    const bodies = buildAdminSlashCommandBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.name).toBe(ADMIN_COMMAND_NAME);
    const options = bodies[0]?.options ?? [];
    const names = options.map((opt) => ("name" in opt ? opt.name : ""));
    expect(names).toEqual([
      "status",
      "health",
      "sources",
      "cycle",
      "resume",
      "reanalyse",
      "interventions",
    ]);
  });
});

describe("createBotHolderId", () => {
  it("builds a bounded non-secret holder id", () => {
    const id = createBotHolderId({
      prefix: "bot",
      host: "host",
      pid: 42,
      randomSuffix: "abcdef",
    });
    expect(id).toBe("bot:host:42:abcdef");
    expect(id).not.toMatch(/token|postgres|secret/i);
  });
});

describe("formatters", () => {
  it("formats pipeline status without secrets", () => {
    const text = formatPipelineStatus({
      lock: {
        id: "global",
        runId: null,
        holderId: null,
        acquiredAt: null,
        heartbeatAt: null,
        expiresAt: null,
      },
      latestRun: null,
      publication: {
        needingResume: 1,
        inconsistent: 2,
        partial: 0,
        failed: 1,
      },
      analysis: { exhaustedFolders: 0 },
      matching: { ambiguousRecent: 3 },
      folders: { closed: 1 },
    });
    expect(text).toContain("status pipeline");
    expect(text).toContain("inconsistent=2");
    expect(text).not.toMatch(/postgresql:\/\//i);
  });

  it("formats sources status", () => {
    const text = formatSourcesStatus({
      registryPath: "config/sources.json",
      definitionCount: 1,
      enabledCount: 1,
      sources: [
        {
          sourceId: "src_a",
          name: "A",
          enabled: true,
          tier: "S",
          lastSuccessfulAt: null,
          lastHttpStatus: 200,
          consecutiveFailures: 0,
          nextEligibleAt: null,
          inBackoff: false,
        },
      ],
    });
    expect(text).toContain("src_a");
    expect(text).toContain("enabled=1");
  });

  it("formats health dashboard", () => {
    const text = formatHealthDashboard({
      generatedAt: new Date("2026-08-01T12:00:00.000Z"),
      sources: { live: 20, broken: 1, disabled: 1, enabled: 21, inBackoff: 0 },
      articles: { total: 100 },
      folders: { total: 10, open: 8, closed: 2 },
      analyses: { total: 12, exhaustedFolders: 0 },
      publications: {
        total: 5,
        mainPublished: 4,
        needingResume: 0,
        failed: 1,
        partial: 0,
        inconsistent: 0,
      },
      errors: { latestRunErrorCount: 0, latestRunErrorCodes: [] },
      timing: { averageCycleDurationMs: 1200, lastCycleDurationMs: 900 },
      lastPublicationAt: new Date("2026-08-01T11:00:00.000Z"),
      lastSuccessfulCycleAt: new Date("2026-08-01T11:30:00.000Z"),
    });
    expect(text).toContain("health");
    expect(text).toContain("vivantes=20");
    expect(text).toContain("cassées=1");
    expect(text).toContain("1200ms");
  });

  it("forbidden message is stable", () => {
    expect(formatForbidden()).toContain("allowlist");
  });
});

describe("registerAdminInteractions", () => {
  it("rejects non-allowlisted users with ephemeral reply", async () => {
    const config = createConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: "postgresql://radar:changeme@localhost:5432/radar_ia",
      OLLAMA_MODEL: "example-ministral-tag",
      DISCORD_ADMIN_USER_IDS: ADMIN_ID,
    });

    let interactionHandler:
      | ((interaction: {
          isChatInputCommand: () => boolean;
          commandName: string;
          user: { id: string };
          reply: ReturnType<typeof vi.fn>;
          deferred: boolean;
          replied: boolean;
        }) => void)
      | undefined;

    const client = {
      on: vi.fn((event: string, handler: typeof interactionHandler) => {
        if (event === "interactionCreate") {
          interactionHandler = handler;
        }
      }),
    };

    const ops = {
      getPipelineStatus: vi.fn(),
      getSourcesStatus: vi.fn(),
      getHealthDashboard: vi.fn(),
      listInterventions: vi.fn(),
      runCycle: vi.fn(),
      resumePublication: vi.fn(),
      resumeAllRetryable: vi.fn(),
      forceReanalysis: vi.fn(),
    };

    registerAdminInteractions({
      client: client as never,
      config,
      runtime: {
        prisma: {} as never,
        ops: ops as never,
        pipelineOrchestrator: { runCycle: vi.fn() } as never,
        registryPath: "config/sources.json",
        loadRegistry: vi.fn(),
        disconnect: vi.fn(),
      },
    });

    expect(client.on).toHaveBeenCalled();
    expect(interactionHandler).toBeTypeOf("function");

    const reply = vi.fn(async () => undefined);
    await Promise.resolve(
      interactionHandler?.({
        isChatInputCommand: () => true,
        commandName: ADMIN_COMMAND_NAME,
        user: { id: OTHER_ID },
        reply,
        deferred: false,
        replied: false,
      }),
    );

    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        flags: MessageFlags.Ephemeral,
        content: expect.stringContaining("refusé"),
      }),
    );
    expect(ops.getPipelineStatus).not.toHaveBeenCalled();
  });

  it("allowlisted status calls admin ops and replies ephemeral", async () => {
    const config = createConfig({
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DATABASE_URL: "postgresql://radar:changeme@localhost:5432/radar_ia",
      OLLAMA_MODEL: "example-ministral-tag",
      DISCORD_ADMIN_USER_IDS: ADMIN_ID,
    });

    let interactionHandler:
      | ((interaction: Record<string, unknown>) => void)
      | undefined;

    const client = {
      on: vi.fn((event: string, handler: typeof interactionHandler) => {
        if (event === "interactionCreate") {
          interactionHandler = handler;
        }
      }),
    };

    const ops = {
      getPipelineStatus: vi.fn(async () => ({
        lock: {
          id: "global",
          runId: null,
          holderId: null,
          acquiredAt: null,
          heartbeatAt: null,
          expiresAt: null,
        },
        latestRun: null,
        publication: {
          needingResume: 0,
          inconsistent: 0,
          partial: 0,
          failed: 0,
        },
        analysis: { exhaustedFolders: 0 },
        matching: { ambiguousRecent: 0 },
        folders: { closed: 0 },
      })),
      getSourcesStatus: vi.fn(),
      getHealthDashboard: vi.fn(),
      listInterventions: vi.fn(),
      runCycle: vi.fn(),
      resumePublication: vi.fn(),
      resumeAllRetryable: vi.fn(),
      forceReanalysis: vi.fn(),
    };

    registerAdminInteractions({
      client: client as never,
      config,
      runtime: {
        prisma: {} as never,
        ops: ops as never,
        pipelineOrchestrator: { runCycle: vi.fn() } as never,
        registryPath: "config/sources.json",
        loadRegistry: vi.fn(),
        disconnect: vi.fn(),
      },
    });

    const deferReply = vi.fn(async function (this: { deferred: boolean }) {
      this.deferred = true;
    });
    const editReply = vi.fn(async () => undefined);
    const interaction = {
      isChatInputCommand: () => true,
      commandName: ADMIN_COMMAND_NAME,
      user: { id: ADMIN_ID },
      options: {
        getSubcommand: () => "status",
        getString: () => null,
        getBoolean: () => false,
      },
      deferReply,
      editReply,
      reply: vi.fn(),
      deferred: false,
      replied: false,
    };
    deferReply.mockImplementation(async () => {
      interaction.deferred = true;
    });

    await Promise.resolve(interactionHandler?.(interaction));

    await new Promise((r) => setTimeout(r, 0));

    expect(ops.getPipelineStatus).toHaveBeenCalled();
    expect(deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(editReply).toHaveBeenCalled();
  });
});
