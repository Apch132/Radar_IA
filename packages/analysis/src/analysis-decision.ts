import type { AnalysisProposalV1 } from "./analysis-proposal-types.js";
import type {
  ChannelSalonHint,
  PublicationDecision,
} from "./analysis-service-types.js";

type PublishWorthiness =
  AnalysisProposalV1["editorialProposal"]["publishWorthiness"];

export interface PublicationDecisionInput {
  readonly validationStatus: "accepted" | "accepted_with_warnings" | "rejected";
  readonly composite: number;
  readonly publishWorthiness: PublishWorthiness;
  readonly hasMainPublication: boolean;
  /** Réanalyse après attach_enrich matériel. */
  readonly isMaterialEnrichReanalysis: boolean;
  readonly anchoredFactCount: number;
  /** Nombre de décisions `hold` déjà persistées pour la même empreinte. */
  readonly priorHoldCount: number;
  /** Motif technique forçant hold (context_too_large, model_mismatch, …). */
  readonly technicalHoldReason?: string | null;
}

export interface PublicationDecisionResult {
  readonly decision: PublicationDecision;
}

function meetsPublish(input: {
  hasMainPublication: boolean;
  composite: number;
  publishWorthiness: PublishWorthiness;
}): boolean {
  if (input.hasMainPublication) {
    return false;
  }
  if (input.composite < 70) {
    return false;
  }
  const { publishWorthiness, composite } = input;
  if (publishWorthiness === "none") {
    return composite >= 90;
  }
  if (publishWorthiness === "high" || publishWorthiness === "medium") {
    return true;
  }
  return composite >= 85;
}

function meetsEnrichThreadOnly(input: {
  hasMainPublication: boolean;
  isMaterialEnrichReanalysis: boolean;
  composite: number;
  anchoredFactCount: number;
}): boolean {
  if (!input.hasMainPublication) {
    return false;
  }
  if (!input.isMaterialEnrichReanalysis) {
    return false;
  }
  return input.composite >= 50 || input.anchoredFactCount >= 1;
}

function meetsRejectEditorialScores(input: {
  composite: number;
  publishWorthiness: PublishWorthiness;
}): boolean {
  if (input.composite < 45) {
    return true;
  }
  if (input.publishWorthiness === "none" && input.composite < 70) {
    return true;
  }
  return false;
}

/**
 * Décision de publication backend (gel 007.1A §9.4–§9.7).
 * Aucune 5ᵉ issue.
 */
export function decidePublication(
  input: PublicationDecisionInput,
): PublicationDecisionResult {
  if (input.technicalHoldReason) {
    return { decision: "hold" };
  }

  if (
    input.validationStatus !== "accepted" &&
    input.validationStatus !== "accepted_with_warnings"
  ) {
    return { decision: "hold" };
  }

  if (meetsPublish(input)) {
    return { decision: "publish" };
  }

  if (meetsEnrichThreadOnly(input)) {
    return { decision: "enrich_thread_only" };
  }

  // Anti-blocage : 2 hold déjà enregistrés → reject_editorial (§9.5 branche B).
  if (input.priorHoldCount >= 2) {
    return { decision: "reject_editorial" };
  }

  if (meetsRejectEditorialScores(input)) {
    return { decision: "reject_editorial" };
  }

  return { decision: "hold" };
}

export interface ChannelMappingInput {
  readonly composite: number;
  readonly effectiveImpact: number;
  readonly primaryCategory: AnalysisProposalV1["classification"]["primaryCategory"];
  readonly suggestedChannelRole: AnalysisProposalV1["editorialProposal"]["suggestedChannelRole"];
}

/**
 * Mapping salon backend (gel 007.1A §9.8) — hint uniquement, pas de Discord.
 */
export function mapChannelSalonHint(
  input: ChannelMappingInput,
): ChannelSalonHint {
  if (
    input.composite >= 85 &&
    (input.effectiveImpact >= 80 ||
      input.primaryCategory === "model_release" ||
      input.primaryCategory === "funding_or_corp")
  ) {
    return "annonces_majeures";
  }

  if (input.composite >= 70 && input.suggestedChannelRole === "flux_ia") {
    return "flux_ia";
  }

  if (input.composite >= 70) {
    return "veille_pertinente";
  }

  return "none";
}
