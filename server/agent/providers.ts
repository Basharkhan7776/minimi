import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { envKeyForProvider } from "../provider-env";
import { getProvider, getFirstUsableProvider } from "../db/providers";
import type { ProviderConfig, Session } from "../db/types";

export interface ResolvedModel {
  provider: ProviderConfig;
  modelId: string;
  model: LanguageModel;
}

export function buildModel(
  provider: ProviderConfig,
  modelId?: string | null,
): ResolvedModel {
  const id = modelId || provider.defaultModel;
  if (!id) {
    throw new Error(`No model configured for provider "${provider.name}"`);
  }

  const apiKey = provider.apiKey || envKeyForProvider(provider.type);

  if (!apiKey && provider.type !== "ollama" && provider.type !== "custom") {
    throw new Error(
      `Add an API key for ${provider.name} in Settings to start chatting.`,
    );
  }

  let model: LanguageModel;
  switch (provider.type) {
    case "openai":
      model = createOpenAI({
        apiKey,
        baseURL: provider.baseUrl ?? undefined,
      }).languageModel(id);
      break;
    case "anthropic":
      model = createAnthropic({
        apiKey,
        baseURL: provider.baseUrl ?? undefined,
      }).languageModel(id);
      break;
    case "google":
      model = createGoogleGenerativeAI({
        apiKey,
        baseURL: provider.baseUrl ?? undefined,
      }).languageModel(id);
      break;
    case "openrouter":
      model = createOpenAICompatible({
        name: "openrouter",
        baseURL: provider.baseUrl ?? "https://openrouter.ai/api/v1",
        apiKey,
        headers: {
          "HTTP-Referer": "http://localhost",
          "X-Title": "Minimi",
        },
      }).languageModel(id);
      break;
    case "ollama":
      model = createOpenAICompatible({
        name: "ollama",
        baseURL: provider.baseUrl ?? "http://127.0.0.1:11434/v1",
        apiKey: apiKey || "ollama",
      }).languageModel(id);
      break;
    case "custom":
      model = createOpenAICompatible({
        name: provider.id,
        baseURL: provider.baseUrl ?? "https://api.openai.com/v1",
        apiKey: apiKey || "none",
      }).languageModel(id);
      break;
    default:
      throw new Error(`Unsupported provider type: ${provider.type}`);
  }

  return { provider, modelId: id, model };
}

export function resolveSessionModel(session: Session): ResolvedModel {
  const provider = session.providerId ? getProvider(session.providerId) : null;
  const chosen = provider ?? getFirstUsableProvider();
  if (!chosen) {
    throw new Error(
      "No provider is configured. Open Settings → Providers and add an API key or start Ollama.",
    );
  }
  return buildModel(chosen, session.model);
}

export function resolveProviderModel(
  providerId: string,
  modelId?: string | null,
): ResolvedModel {
  const provider = getProvider(providerId);
  if (!provider) throw new Error(`Unknown provider "${providerId}"`);
  return buildModel(provider, modelId);
}
