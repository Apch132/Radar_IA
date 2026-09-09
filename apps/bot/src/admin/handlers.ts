import type { Config } from "@radar-ia/config";
import {
  Events,
  MessageFlags,
  type ChatInputCommandInteraction,
  type Client,
  type Interaction,
} from "discord.js";

import { isAllowlistedAdmin } from "./allowlist.js";
import { ADMIN_COMMAND_NAME } from "./commands.js";
import {
  formatCycleResult,
  formatForbidden,
  formatGenericError,
  formatHealthDashboard,
  formatInterventions,
  formatPipelineStatus,
  formatRateLimited,
  formatSourcesStatus,
} from "./format.js";
import { createBotHolderId } from "./holder-id.js";
import type { AdminOpsRuntime } from "./ops-runtime.js";
import {
  createAdminRateLimiter,
  type AdminRateLimiter,
} from "./rate-limit.js";

export type RegisterAdminInteractionsOptions = {
  readonly client: Client;
  readonly config: Config;
  readonly runtime: AdminOpsRuntime;
  /** Stable holder id for manual cycles (defaults to bot:host:pid:suffix). */
  readonly holderId?: string;
  readonly rateLimiter?: AdminRateLimiter;
};

async function replyEphemeral(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content });
    return;
  }
  await interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function handleAdminCommand(
  interaction: ChatInputCommandInteraction,
  options: RegisterAdminInteractionsOptions,
  rateLimiter: AdminRateLimiter,
): Promise<void> {
  const userId = interaction.user.id;
  if (!isAllowlistedAdmin(userId, options.config.discord.adminUserIds)) {
    await replyEphemeral(interaction, formatForbidden());
    return;
  }

  const sub = interaction.options.getSubcommand(true);
  const rate = rateLimiter.check(userId, sub);
  if (!rate.allowed) {
    await replyEphemeral(interaction, formatRateLimited(rate.retryAfterMs));
    return;
  }

  const actor = { actorId: userId };
  const { ops, registryPath, loadRegistry } = options.runtime;

  try {
    if (sub === "status") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const status = await ops.getPipelineStatus();
      await replyEphemeral(interaction, formatPipelineStatus(status));
      return;
    }

    if (sub === "health") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const health = await ops.getHealthDashboard({ loadRegistry });
      await replyEphemeral(interaction, formatHealthDashboard(health));
      return;
    }

    if (sub === "sources") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const status = await ops.getSourcesStatus({
        loadRegistry,
        registryPath,
      });
      await replyEphemeral(interaction, formatSourcesStatus(status));
      return;
    }

    if (sub === "interventions") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const items = await ops.listInterventions({ limit: 25 });
      await replyEphemeral(interaction, formatInterventions(items));
      return;
    }

    if (sub === "cycle") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const holderId =
        options.holderId ?? createBotHolderId({ prefix: "bot" });
      const result = await ops.runCycle(actor, { holderId });
      await replyEphemeral(
        interaction,
        formatCycleResult(result.outcome, result.auditId, result.cycle),
      );
      return;
    }

    if (sub === "resume") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const folderId = interaction.options.getString("folder_id");
      if (folderId !== null && folderId.trim() !== "") {
        const result = await ops.resumePublication(actor, {
          folderId: folderId.trim(),
        });
        await replyEphemeral(
          interaction,
          `**Radar IA — resume**\nOutcome: ${result.outcome} · folder=\`${result.folderId}\` · ${result.detail} · audit=\`${result.auditId}\``,
        );
        return;
      }
      const batch = await ops.resumeAllRetryable(actor);
      await replyEphemeral(
        interaction,
        `**Radar IA — resume**\nOutcome: ${batch.outcome} · count=${batch.results.length} · audit=\`${batch.auditId}\``,
      );
      return;
    }

    if (sub === "reanalyse") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const folderId = interaction.options.getString("folder_id", true);
      const confirm = interaction.options.getBoolean("confirm", true);
      const result = await ops.forceReanalysis(actor, {
        folderId,
        confirm,
      });
      await replyEphemeral(
        interaction,
        `**Radar IA — reanalyse**\nOutcome: ${result.outcome} · folder=\`${result.folderId}\` · ${result.detail} · audit=\`${result.auditId}\``,
      );
      return;
    }

    await replyEphemeral(interaction, formatGenericError());
  } catch (error) {
    console.error("[radar-admin] internal error", {
      code: "admin_internal_error",
      subcommand: sub,
      actorId: userId,
      message: error instanceof Error ? error.message : "unexpected admin error",
    });
    await replyEphemeral(interaction, formatGenericError()).catch(
      () => undefined,
    );
  }
}

/**
 * Register InteractionCreate handler for `/radar-admin` (ephemeral, allowlisted).
 */
export function registerAdminInteractions(
  options: RegisterAdminInteractionsOptions,
): void {
  const { client } = options;
  const rateLimiter = options.rateLimiter ?? createAdminRateLimiter();

  client.on(Events.InteractionCreate, (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }
    if (interaction.commandName !== ADMIN_COMMAND_NAME) {
      return;
    }
    void handleAdminCommand(interaction, options, rateLimiter);
  });
}
