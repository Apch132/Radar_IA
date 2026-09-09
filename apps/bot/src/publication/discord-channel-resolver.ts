import {
  config as defaultConfig,
  type Config,
  configurationErrorFromMessage,
} from "@radar-ia/config";
import type { PublicationChannelHint } from "@radar-ia/shared";

type PublicationChannelIds = {
  readonly annoncesMajeures: string | null;
  readonly veillePertinente: string | null;
  readonly fluxIa: string | null;
};

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

function requireSnowflake(
  envName: string,
  value: string | undefined,
): string | null {
  if (value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0 || !SNOWFLAKE_PATTERN.test(trimmed)) {
    throw configurationErrorFromMessage(
      [envName],
      `${envName} must be a non-empty Discord snowflake`,
    );
  }

  return trimmed;
}

function normalizeChannelIds(config: Config): PublicationChannelIds {
  const channels = (
    config.discord as Config["discord"] & {
      readonly channels?: {
        readonly annoncesMajeures?: string;
        readonly veillePertinente?: string;
        readonly fluxIa?: string;
      };
    }
  ).channels;

  return {
    annoncesMajeures: requireSnowflake(
      "DISCORD_CHANNEL_ANNONCES_MAJEURES",
      channels?.annoncesMajeures,
    ),
    veillePertinente: requireSnowflake(
      "DISCORD_CHANNEL_VEILLE_PERTINENTE",
      channels?.veillePertinente,
    ),
    fluxIa: requireSnowflake(
      "DISCORD_CHANNEL_FLUX_IA",
      channels?.fluxIa,
    ),
  };
}

export function createPublicationChannelResolver(
  runtimeConfig: Config = defaultConfig,
): (hint: PublicationChannelHint) => string | null {
  const channelIds = normalizeChannelIds(runtimeConfig);

  return (hint: PublicationChannelHint): string | null => {
    switch (hint) {
      case "annonces_majeures":
        return channelIds.annoncesMajeures;
      case "veille_pertinente":
        return channelIds.veillePertinente;
      case "flux_ia":
        return channelIds.fluxIa;
      default: {
        const _exhaustive: never = hint;
        return _exhaustive;
      }
    }
  };
}
