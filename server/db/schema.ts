export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT 'New chat',
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  provider_id TEXT,
  model TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  parts_json TEXT NOT NULL DEFAULT '[]',
  metadata_json TEXT,
  created_at INTEGER NOT NULL,
  model TEXT,
  usage_json TEXT,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  message_id UNINDEXED,
  session_id UNINDEXED,
  role UNINDEXED,
  created_at UNINDEXED,
  tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  message_id TEXT,
  kind TEXT NOT NULL DEFAULT 'fact',
  text TEXT NOT NULL,
  event_date TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  message_id TEXT,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  extracted_text TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_session ON files(session_id);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT,
  api_key TEXT,
  default_model TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  config_json TEXT
);

CREATE TABLE IF NOT EXISTS search_cache (
  query_hash TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  results_json TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS vec_memories USING vec0(
  memory_id TEXT PRIMARY KEY,
  embedding float[384],
  +session_id TEXT,
  +message_id TEXT,
  +event_date TEXT,
  +text TEXT
);
`;

export const DEFAULT_PROVIDERS = [
  {
    id: "openai",
    type: "openai",
    name: "OpenAI",
    defaultModel: "gpt-4.1-mini",
    envKey: "OPENAI_API_KEY",
    sortOrder: 0,
  },
  {
    id: "anthropic",
    type: "anthropic",
    name: "Anthropic",
    defaultModel: "claude-sonnet-4-5",
    envKey: "ANTHROPIC_API_KEY",
    sortOrder: 1,
  },
  {
    id: "google",
    type: "google",
    name: "Google",
    defaultModel: "gemini-2.5-flash",
    envKey: "GOOGLE_GENERATIVE_AI_API_KEY",
    sortOrder: 2,
  },
  {
    id: "openrouter",
    type: "openrouter",
    name: "OpenRouter",
    defaultModel: "openai/gpt-4.1-mini",
    envKey: "OPENROUTER_API_KEY",
    sortOrder: 3,
  },
  {
    id: "ollama",
    type: "ollama",
    name: "Ollama (local)",
    defaultModel: "llama3.2",
    envKey: null,
    sortOrder: 4,
  },
] as const;
