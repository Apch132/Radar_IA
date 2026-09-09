import type {
  AdminHealthDashboard,
  AdminInterventionItem,
  AdminPipelineStatus,
  AdminSourcesStatus,
  PipelineCycleResult,
} from "@radar-ia/database";

const DISCORD_CONTENT_LIMIT = 1900;

function clamp(text: string): string {
  if (text.length <= DISCORD_CONTENT_LIMIT) {
    return text;
  }
  return `${text.slice(0, DISCORD_CONTENT_LIMIT - 1)}…`;
}

function redact(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "[redacted]")
    .replace(/DISCORD_TOKEN\s*=\s*\S+/gi, "[redacted]")
    .replace(/DATABASE_URL\s*=\s*\S+/gi, "[redacted]");
}

/** Format pipeline status for an ephemeral Discord reply. */
export function formatPipelineStatus(status: AdminPipelineStatus): string {
  const lockHeld = status.lock.holderId !== null && status.lock.runId !== null;
  const run = status.latestRun;
  const lines = [
    "**Radar IA — status pipeline**",
    `Lock: ${lockHeld ? `held by \`${status.lock.holderId}\`` : "free"}`,
    run
      ? `Dernier run: \`${run.id}\` · ${run.status} · trigger=${run.trigger}`
      : "Dernier run: (aucun)",
    `Publications: resume=${status.publication.needingResume} · partial=${status.publication.partial} · failed=${status.publication.failed} · inconsistent=${status.publication.inconsistent}`,
    `Analyse exhausted: ${status.analysis.exhaustedFolders}`,
    `Matching ambiguous (7j): ${status.matching.ambiguousRecent}`,
    `Dossiers closed: ${status.folders.closed}`,
  ];
  return clamp(redact(lines.join("\n")));
}

/** Format health dashboard for an ephemeral Discord reply. */
export function formatHealthDashboard(health: AdminHealthDashboard): string {
  const avg =
    health.timing.averageCycleDurationMs === null
      ? "—"
      : `${health.timing.averageCycleDurationMs}ms`;
  const lastPub =
    health.lastPublicationAt === null
      ? "—"
      : health.lastPublicationAt.toISOString();
  const lastCycle =
    health.lastSuccessfulCycleAt === null
      ? "—"
      : health.lastSuccessfulCycleAt.toISOString();
  const errorCodes =
    health.errors.latestRunErrorCodes.length === 0
      ? "aucune"
      : health.errors.latestRunErrorCodes.slice(0, 8).join(", ");

  const lines = [
    "**Radar IA — health**",
    `Sources: vivantes=${health.sources.live} · cassées=${health.sources.broken} · disabled=${health.sources.disabled} · enabled=${health.sources.enabled} · backoff=${health.sources.inBackoff}`,
    `Articles: ${health.articles.total}`,
    `Dossiers: total=${health.folders.total} · open=${health.folders.open} · closed=${health.folders.closed}`,
    `Analyses: ${health.analyses.total} · exhausted=${health.analyses.exhaustedFolders}`,
    `Publications: total=${health.publications.total} · main=${health.publications.mainPublished} · resume=${health.publications.needingResume} · failed=${health.publications.failed} · partial=${health.publications.partial} · inconsistent=${health.publications.inconsistent}`,
    `Erreurs (dernier run): count=${health.errors.latestRunErrorCount} · codes=${errorCodes}`,
    `Temps moyen cycle: ${avg}`,
    `Dernière publication: ${lastPub}`,
    `Dernier cycle OK: ${lastCycle}`,
  ];
  return clamp(redact(lines.join("\n")));
}

/** Format sources status for an ephemeral Discord reply. */
export function formatSourcesStatus(status: AdminSourcesStatus): string {
  const lines = [
    "**Radar IA — sources**",
    `Registre: \`${status.registryPath}\` · définitions=${status.definitionCount} · enabled=${status.enabledCount}`,
  ];
  for (const source of status.sources.slice(0, 20)) {
    const backoff = source.inBackoff ? "backoff" : "ok";
    lines.push(
      `• \`${source.sourceId}\` [${source.tier}] ${source.enabled ? "on" : "off"} · ${backoff} · http=${source.lastHttpStatus ?? "—"} · fails=${source.consecutiveFailures}`,
    );
  }
  if (status.sources.length > 20) {
    lines.push(`… +${status.sources.length - 20} autres`);
  }
  return clamp(redact(lines.join("\n")));
}

/** Format intervention list for an ephemeral Discord reply. */
export function formatInterventions(
  items: readonly AdminInterventionItem[],
): string {
  if (items.length === 0) {
    return "**Radar IA — interventions**\nAucune file en attente.";
  }
  const lines = ["**Radar IA — interventions**"];
  for (const item of items) {
    lines.push(
      `• ${item.reason} · folder=\`${item.folderId ?? "—"}\` · article=\`${item.articleId ?? "—"}\`${item.detail ? ` · ${item.detail}` : ""}`,
    );
  }
  return clamp(redact(lines.join("\n")));
}

/** Format manual cycle result. */
export function formatCycleResult(
  outcome: string,
  auditId: string,
  cycle: PipelineCycleResult,
): string {
  const lines = [
    "**Radar IA — cycle manuel**",
    `Outcome: ${outcome} · audit=\`${auditId}\``,
    `Run: \`${cycle.runId ?? "—"}\` · status=${cycle.status ?? "none"} · lock=${cycle.lockAcquired}`,
    cycle.rejectionCode ? `Rejection: ${cycle.rejectionCode}` : null,
    `Sources collected=${cycle.sources.collected} failed=${cycle.sources.failed}`,
    `Articles created=${cycle.articles.created}`,
    `Matching create=${cycle.matching.create_dossier} ambiguous=${cycle.matching.ambiguous_no_action}`,
    `Analysis analyzed=${cycle.analysis.analyzed} failed=${cycle.analysis.failed}`,
    `Publication published=${cycle.publication.published} resumed=${cycle.publication.resumed} failed=${cycle.publication.failed}`,
  ].filter((line): line is string => line !== null);
  return clamp(redact(lines.join("\n")));
}

export function formatForbidden(): string {
  return "Accès refusé — commande réservée aux administrateurs allowlistés.";
}

/** Safe user-facing admin error — never include raw exception text (AUD-017). */
export function formatGenericError(_detail?: string): string {
  return clamp(
    redact(
      "**Radar IA — erreur**\nCode: `admin_internal_error` · opération interrompue. Détails techniques côté serveur uniquement.",
    ),
  );
}

/** Rate-limit rejection (AUD-019). */
export function formatRateLimited(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return clamp(
    `**Radar IA — rate limit**\nTrop de requêtes. Réessaie dans ~${seconds}s.`,
  );
}
