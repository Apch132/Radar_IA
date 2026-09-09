/**
 * Official publisher whitelist (Correctif 2).
 * Major announcements from these editors should nearly always create a dossier.
 */

export const OFFICIAL_PUBLISHERS = [
  "OpenAI",
  "Anthropic",
  "Google",
  "DeepMind",
  "Meta",
  "Mistral",
  "Cursor",
  "Qwen",
  "DeepSeek",
  "AI2",
  "Ollama",
  "Hugging Face",
] as const;

export type OfficialPublisher = (typeof OFFICIAL_PUBLISHERS)[number];

/** Source IDs mapped to the official whitelist publishers. */
export const OFFICIAL_WHITELIST_SOURCE_IDS = [
  "openai-news",
  "anthropic-news",
  "google-ai",
  "google-deepmind",
  "meta-ai-blog",
  "llama-models-releases",
  "mistral-news",
  "cursor-blog",
  "cursor-changelog",
  "qwen-blog",
  "deepseek-r1-releases",
  "ai2-blog",
  "ollama-blog",
  "ollama-releases",
  "huggingface-blog",
  "transformers-releases",
] as const;

export type OfficialWhitelistSourceId =
  (typeof OFFICIAL_WHITELIST_SOURCE_IDS)[number];

const OFFICIAL_SOURCE_SET = new Set<string>(OFFICIAL_WHITELIST_SOURCE_IDS);

const SOURCE_TO_PUBLISHER: Readonly<Record<string, OfficialPublisher>> = {
  "openai-news": "OpenAI",
  "anthropic-news": "Anthropic",
  "google-ai": "Google",
  "google-deepmind": "DeepMind",
  "meta-ai-blog": "Meta",
  "llama-models-releases": "Meta",
  "mistral-news": "Mistral",
  "cursor-blog": "Cursor",
  "cursor-changelog": "Cursor",
  "qwen-blog": "Qwen",
  "deepseek-r1-releases": "DeepSeek",
  "ai2-blog": "AI2",
  "ollama-blog": "Ollama",
  "ollama-releases": "Ollama",
  "huggingface-blog": "Hugging Face",
  "transformers-releases": "Hugging Face",
};

export function isOfficialWhitelistSource(sourceId: string | undefined): boolean {
  if (sourceId === undefined) {
    return false;
  }
  return OFFICIAL_SOURCE_SET.has(sourceId);
}

export function resolveOfficialPublisher(
  sourceId: string | undefined,
): OfficialPublisher | null {
  if (sourceId === undefined) {
    return null;
  }
  return SOURCE_TO_PUBLISHER[sourceId] ?? null;
}
