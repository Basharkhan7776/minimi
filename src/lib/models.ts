import type { PublicProvider } from "./types";

export const MODEL_SUGGESTIONS: Record<string, string[]> = {
  openai: ["gpt-4.1-mini", "gpt-4.1", "gpt-5-mini", "o4-mini"],
  anthropic: [
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
    "claude-opus-4-1",
  ],
  google: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.5-flash-lite"],
  openrouter: [
    "openai/gpt-4.1-mini",
    "anthropic/claude-sonnet-4.5",
    "google/gemini-2.5-flash",
    "deepseek/deepseek-chat",
  ],
  ollama: ["llama3.2", "qwen2.5:7b", "mistral:7b", "gemma3:4b"],
  custom: ["gpt-4.1-mini", "llama3.2"],
};

export function modelOptions(provider: PublicProvider | undefined): string[] {
  if (!provider) return [];
  const base = MODEL_SUGGESTIONS[provider.type] ?? [];
  const current = provider.defaultModel ? [provider.defaultModel] : [];
  return [...new Set([...current, ...base])];
}

export function providerInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "?";
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: "#10a37f",
  anthropic: "#d97757",
  google: "#4285f4",
  openrouter: "#6366f1",
  ollama: "#111827",
  custom: "#64748b",
};

export function providerColor(type: string): string {
  return PROVIDER_COLORS[type] ?? "#64748b";
}
