import {
  SlashCommandBuilder,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";

/** Root slash command name for administration surface. */
export const ADMIN_COMMAND_NAME = "radar-admin";

/**
 * Build Discord slash command definitions for 009.1E.
 * Names are implementation choices (gel left them unfrozen).
 */
export function buildAdminSlashCommandBodies(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  const command = new SlashCommandBuilder()
    .setName(ADMIN_COMMAND_NAME)
    .setDescription("Radar IA — administration (allowlist)")
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("État du pipeline (technique / files métier)"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("health")
        .setDescription(
          "Dashboard de santé (sources, articles, dossiers, publications)",
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("sources")
        .setDescription("État des sources (registre + backoff runtime)"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("cycle")
        .setDescription("Lancer manuellement un cycle de veille"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("resume")
        .setDescription("Reprendre les publications retryables")
        .addStringOption((opt) =>
          opt
            .setName("folder_id")
            .setDescription("Dossier ciblé (sinon toutes les reprises)")
            .setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("reanalyse")
        .setDescription("Forcer une réanalyse (confirmation obligatoire)")
        .addStringOption((opt) =>
          opt
            .setName("folder_id")
            .setDescription("Identifiant du dossier")
            .setRequired(true),
        )
        .addBooleanOption((opt) =>
          opt
            .setName("confirm")
            .setDescription("Doit être true pour confirmer")
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("interventions")
        .setDescription("Dossiers / files nécessitant une intervention"),
    );

  return [command.toJSON()];
}
