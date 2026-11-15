import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { DB_PATH, ensureDataDirs } from "../config";
import { DEFAULT_PROVIDERS, SCHEMA_SQL } from "./schema";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  ensureDataDirs();
  const instance = new Database(DB_PATH);
  instance.pragma("journal_mode = WAL");
  instance.pragma("foreign_keys = ON");
  instance.pragma("synchronous = NORMAL");
  try {
    instance.loadExtension(sqliteVec.getLoadablePath());
  } catch (error) {
    console.error("[db] failed to load sqlite-vec extension", error);
  }
  instance.exec(SCHEMA_SQL);
  migrate(instance);
  seedProviders(instance);
  setDefaultSettings(instance);
  db = instance;
  return instance;
}

function migrate(instance: Database.Database): void {
  const columns = instance
    .prepare("PRAGMA table_info(messages)")
    .all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "metadata_json")) {
    instance.exec("ALTER TABLE messages ADD COLUMN metadata_json TEXT");
  }
}

function seedProviders(instance: Database.Database): void {
  const insert = instance.prepare(`
    INSERT OR IGNORE INTO providers
      (id, type, name, base_url, api_key, default_model, enabled, sort_order, config_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `);
  const existing = instance.prepare(
    "SELECT api_key FROM providers WHERE id = ?",
  );
  const adoptEnvKey = instance.prepare(
    "UPDATE providers SET api_key = ?, enabled = 1 WHERE id = ?",
  );

  const transaction = instance.transaction(() => {
    for (const provider of DEFAULT_PROVIDERS) {
      const envKey = provider.envKey
        ? (process.env[provider.envKey] ?? null)
        : null;
      const current = existing.get(provider.id) as
        | { api_key: string | null }
        | undefined;
      if (current) {
        if (envKey && !current.api_key) adoptEnvKey.run(envKey, provider.id);
        continue;
      }
      insert.run(
        provider.id,
        provider.type,
        provider.name,
        provider.type === "ollama" ? "http://127.0.0.1:11434/v1" : null,
        envKey,
        provider.defaultModel,
        provider.type === "ollama" ? 1 : envKey ? 1 : 0,
        provider.sortOrder,
      );
    }
  });
  transaction();
}

function setDefaultSettings(instance: Database.Database): void {
  const defaults: Record<string, string> = {
    "search.provider": "duckduckgo",
    "search.maxResults": "5",
    "search.cacheTtlMinutes": "180",
    "memory.enabled": "1",
    "memory.autoExtract": "1",
    "chat.maxSteps": "8",
    "chat.autoTitle": "1",
    "app.theme": "system",
  };
  const insert = instance.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
  );
  const transaction = instance.transaction(() => {
    for (const [key, value] of Object.entries(defaults)) insert.run(key, value);
  });
  transaction();
}

export function getSetting(key: string): string | undefined {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

export function getAllSettings(): Record<string, string> {
  const rows = getDb()
    .prepare("SELECT key, value FROM settings")
    .all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function closeDb(): void {
  db?.close();
  db = null;
}

export { DB_PATH };
