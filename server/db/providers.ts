import { getDb } from "./index";
import type { ProviderConfig } from "./types";

interface ProviderRow {
  id: string;
  type: string;
  name: string;
  base_url: string | null;
  api_key: string | null;
  default_model: string | null;
  enabled: number;
  sort_order: number;
  config_json: string | null;
}

function mapProvider(row: ProviderRow): ProviderConfig {
  return {
    id: row.id,
    type: row.type as ProviderConfig["type"],
    name: row.name,
    baseUrl: row.base_url,
    apiKey: row.api_key,
    defaultModel: row.default_model,
    enabled: Boolean(row.enabled),
    sortOrder: row.sort_order,
    config: row.config_json ? JSON.parse(row.config_json) : null,
  };
}

export function listProviders(): ProviderConfig[] {
  const rows = getDb()
    .prepare("SELECT * FROM providers ORDER BY sort_order ASC, name ASC")
    .all() as ProviderRow[];
  return rows.map(mapProvider);
}

export function getProvider(id: string): ProviderConfig | null {
  const row = getDb()
    .prepare("SELECT * FROM providers WHERE id = ?")
    .get(id) as ProviderRow | undefined;
  return row ? mapProvider(row) : null;
}

export function updateProvider(
  id: string,
  patch: Partial<{
    name: string;
    baseUrl: string | null;
    apiKey: string | null;
    defaultModel: string | null;
    enabled: boolean;
    sortOrder: number;
    config: Record<string, unknown> | null;
  }>,
): ProviderConfig | null {
  const existing = getProvider(id);
  if (!existing) return null;
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.name !== undefined) {
    fields.push("name = ?");
    values.push(patch.name);
  }
  if (patch.baseUrl !== undefined) {
    fields.push("base_url = ?");
    values.push(patch.baseUrl);
  }
  if (patch.apiKey !== undefined) {
    fields.push("api_key = ?");
    values.push(patch.apiKey);
  }
  if (patch.defaultModel !== undefined) {
    fields.push("default_model = ?");
    values.push(patch.defaultModel);
  }
  if (patch.enabled !== undefined) {
    fields.push("enabled = ?");
    values.push(patch.enabled ? 1 : 0);
  }
  if (patch.sortOrder !== undefined) {
    fields.push("sort_order = ?");
    values.push(patch.sortOrder);
  }
  if (patch.config !== undefined) {
    fields.push("config_json = ?");
    values.push(patch.config ? JSON.stringify(patch.config) : null);
  }
  if (fields.length > 0) {
    values.push(id);
    getDb()
      .prepare(`UPDATE providers SET ${fields.join(", ")} WHERE id = ?`)
      .run(...values);
  }
  return getProvider(id);
}

export function createProvider(input: {
  id: string;
  type: ProviderConfig["type"];
  name: string;
  baseUrl?: string | null;
  apiKey?: string | null;
  defaultModel?: string | null;
  enabled?: boolean;
}): ProviderConfig {
  getDb()
    .prepare(
      `INSERT INTO providers (id, type, name, base_url, api_key, default_model, enabled, sort_order, config_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, 100, NULL)`,
    )
    .run(
      input.id,
      input.type,
      input.name,
      input.baseUrl ?? null,
      input.apiKey ?? null,
      input.defaultModel ?? null,
      input.enabled === false ? 0 : 1,
    );
  return getProvider(input.id)!;
}

export function deleteProvider(id: string): void {
  getDb().prepare("DELETE FROM providers WHERE id = ?").run(id);
}

export function getFirstUsableProvider(): ProviderConfig | null {
  const providers = listProviders().filter((provider) => provider.enabled);
  return (
    providers.find((provider) => Boolean(provider.apiKey)) ??
    providers.find((provider) => provider.type === "ollama") ??
    providers[0] ??
    null
  );
}
