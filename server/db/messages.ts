import type { UIMessage } from "ai";
import { getDb } from "./index";
import type { StoredMessage } from "./types";

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  parts_json: string;
  metadata_json: string | null;
  created_at: number;
  model: string | null;
  usage_json: string | null;
  error: string | null;
}

function mapMessage(row: MessageRow): StoredMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role as UIMessage["role"],
    content: row.content,
    parts: JSON.parse(row.parts_json) as UIMessage["parts"],
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
    createdAt: row.created_at,
    model: row.model,
    usage: row.usage_json ? JSON.parse(row.usage_json) : null,
    error: row.error,
  };
}

export function extractText(parts: UIMessage["parts"]): string {
  const chunks: string[] = [];
  for (const part of parts) {
    if (part.type === "text") chunks.push(part.text);
    if (part.type === "reasoning") chunks.push(part.text);
    if (part.type === "source-url" && part.title) chunks.push(part.title);
    if (part.type === "file" && part.filename) chunks.push(`[file: ${part.filename}]`);
  }
  return chunks.join("\n").trim();
}

export function upsertMessage(
  sessionId: string,
  message: UIMessage,
  meta?: { model?: string | null; usage?: unknown; error?: string | null },
): void {
  const db = getDb();
  const now = Date.now();
  const content = extractText(message.parts);
  const existing = db
    .prepare("SELECT created_at FROM messages WHERE id = ?")
    .get(message.id) as { created_at: number } | undefined;
  const createdAt = existing?.created_at ?? now;

  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT INTO messages (id, session_id, role, content, parts_json, metadata_json, created_at, model, usage_json, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         content = excluded.content,
         parts_json = excluded.parts_json,
         metadata_json = excluded.metadata_json,
         model = excluded.model,
         usage_json = excluded.usage_json,
         error = excluded.error`,
    ).run(
      message.id,
      sessionId,
      message.role,
      content,
      JSON.stringify(message.parts),
      message.metadata ? JSON.stringify(message.metadata) : null,
      createdAt,
      meta?.model ?? null,
      meta?.usage ? JSON.stringify(meta.usage) : null,
      meta?.error ?? null,
    );

    db.prepare("DELETE FROM messages_fts WHERE message_id = ?").run(message.id);
    if (content) {
      db.prepare(
        "INSERT INTO messages_fts (content, message_id, session_id, role, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(content, message.id, sessionId, message.role, createdAt);
    }
    db.prepare("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, sessionId);
  });
  transaction();
}

export function getUiMessages(sessionId: string): UIMessage[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC",
    )
    .all(sessionId) as MessageRow[];
  return rows.map((row) => ({
    id: row.id,
    role: row.role as UIMessage["role"],
    parts: JSON.parse(row.parts_json) as UIMessage["parts"],
    ...(row.metadata_json
      ? { metadata: JSON.parse(row.metadata_json) }
      : {}),
  }));
}

export function getStoredMessages(sessionId: string): StoredMessage[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC",
    )
    .all(sessionId) as MessageRow[];
  return rows.map(mapMessage);
}

export function getAllMessagesForExport(): Array<
  StoredMessage & { sessionId: string }
> {
  const rows = getDb()
    .prepare("SELECT * FROM messages ORDER BY created_at ASC")
    .all() as MessageRow[];
  return rows.map(mapMessage);
}

export function deleteMessage(id: string): void {
  const db = getDb();
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM messages_fts WHERE message_id = ?").run(id);
    db.prepare("DELETE FROM messages WHERE id = ?").run(id);
  });
  transaction();
}

export function countMessages(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM messages").get() as {
    n: number;
  };
  return row.n;
}

export function searchMessages(options: {
  query: string;
  from?: number;
  to?: number;
  limit?: number;
}): Array<{
  messageId: string;
  sessionId: string;
  role: string;
  createdAt: number;
  content: string;
  title: string;
}> {
  const db = getDb();
  const limit = options.limit ?? 12;
  const clauses = ["messages_fts MATCH ?"];
  const params: unknown[] = [options.query];
  if (options.from !== undefined) {
    clauses.push("CAST(messages_fts.created_at AS INTEGER) >= ?");
    params.push(options.from);
  }
  if (options.to !== undefined) {
    clauses.push("CAST(messages_fts.created_at AS INTEGER) <= ?");
    params.push(options.to);
  }
  params.push(limit);
  const rows = db
    .prepare(
      `SELECT messages_fts.message_id AS messageId,
              messages_fts.session_id AS sessionId,
              messages_fts.role AS role,
              CAST(messages_fts.created_at AS INTEGER) AS createdAt,
              snippet(messages_fts, 0, '', '', ' … ', 24) AS content,
              COALESCE(s.title, 'Untitled') AS title
       FROM messages_fts
       LEFT JOIN sessions s ON s.id = messages_fts.session_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY CAST(messages_fts.created_at AS INTEGER) DESC
       LIMIT ?`,
    )
    .all(...params) as Array<{
    messageId: string;
    sessionId: string;
    role: string;
    createdAt: number;
    content: string;
    title: string;
  }>;
  return rows;
}
