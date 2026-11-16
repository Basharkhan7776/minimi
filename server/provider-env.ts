const PROVIDER_ENV_KEYS: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
  google: [
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GOOGLE_AI_STUDIO_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
  ],
  openrouter: ["OPENROUTER_API_KEY"],
};

export function envKeyForProvider(type: string): string | undefined {
  for (const name of PROVIDER_ENV_KEYS[type] ?? []) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}
