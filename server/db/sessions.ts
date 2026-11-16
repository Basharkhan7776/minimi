import { nanoid } from "nanoid";
import { getDb } from "./index";
import type { Session } from "./types";

interface SessionRow {
  id: string;
  title: string;
  title_locked: number;
  title_turn: number;
  pinned: number;
  archived: number;
  provider_id: string | null;
  model: string | null;
  created_at: number;
  updated_at: number;
  message_count?: number;
}

function mapSession(row: SessionRow): Session {
  return {
    id: row.id,
    title: row.title,
    titleLocked: Boolean(row.title_locked),
    titleTurn: row.title_turn ?? 0,
    pinned: Boolean(row.pinned),
    archived: Boolean(row.archived),
    providerId: row.provider_id,
    model: row.model,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count ?? 0,
  };
}

export function createSession(input?: {
  title?: string;
  providerId?: string | null;
  model?: string | null;
}): Session {
  const now = Date.now();
  const id = nanoid(12);
  getDb()
    .prepare(
      `INSERT INTO sessions (id, title, pinned, archived, provider_id, model, created_at, updated_at)
       VALUES (?, ?, 0, 0, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input?.title?.trim() || "New chat",
      input?.providerId ?? null,
      input?.model ?? null,
      now,
      now,
    );
  return getSession(id)!;
}

export function getSession(id: string): Session | null {
  const row = getDb()
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
       FROM sessions s WHERE s.id = ?`,
    )
    .get(id) as SessionRow | undefined;
  return row ? mapSession(row) : null;
}

export function listSessions(options?: {
  query?: string;
  pinned?: boolean;
  limit?: number;
}): Session[] {
  const db = getDb();
  const limit = options?.limit ?? 200;
  const query = options?.query?.trim();

  if (query) {
    const like = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    const rows = db
      .prepare(
        `SELECT DISTINCT s.*,
          (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
         FROM sessions s
         LEFT JOIN messages m ON m.session_id = s.id
         WHERE s.archived = 0
           AND (s.title LIKE ? ESCAPE '\\' OR m.content LIKE ? ESCAPE '\\')
         ORDER BY s.pinned DESC, s.updated_at DESC
         LIMIT ?`,
      )
      .all(like, like, limit) as SessionRow[];
    return rows.map(mapSession);
  }

  const pinnedFilter =
    options?.pinned === true
      ? "AND s.pinned = 1"
      : options?.pinned === false
        ? "AND s.pinned = 0"
        : "";
  const rows = db
    .prepare(
      `SELECT s.*,
        (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
       FROM sessions s
       WHERE s.archived = 0 ${pinnedFilter}
       ORDER BY s.pinned DESC, s.updated_at DESC
       LIMIT ?`,
    )
    .all(limit) as SessionRow[];
  return rows.map(mapSession);
}

export function updateSession(
  id: string,
  patch: Partial<{
    title: string;
    pinned: boolean;
    archived: boolean;
    providerId: string | null;
    model: string | null;
  }>,
): Session | null {
  const existing = getSession(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) {
    fields.push("title = ?");
    fields.push("title_locked = 1");
    values.push(patch.title.trim() || "New chat");
  }
  if (patch.pinned !== undefined) {
    fields.push("pinned = ?");
    values.push(patch.pinned ? 1 : 0);
  }
  if (patch.archived !== undefined) {
    fields.push("archived = ?");
    values.push(patch.archived ? 1 : 0);
  }
  if (patch.providerId !== undefined) {
    fields.push("provider_id = ?");
    values.push(patch.providerId);
  }
  if (patch.model !== undefined) {
    fields.push("model = ?");
    values.push(patch.model);
  }
  if (fields.length > 0) {
    values.push(Date.now(), id);
    getDb()
      .prepare(
        `UPDATE sessions SET ${fields.join(", ")}, updated_at = ? WHERE id = ?`,
      )
      .run(...values);
  }
  return getSession(id);
}

export function setAutoTitle(
  id: string,
  title: string,
  userTurn: number,
): void {
  getDb()
    .prepare(
      `UPDATE sessions
       SET title = ?, title_turn = ?, updated_at = ?
       WHERE id = ? AND title_locked = 0`,
    )
    .run(title, userTurn, Date.now(), id);
}

export function countUserMessages(sessionId: string): number {
  const row = getDb()
    .prepare(
      "SELECT COUNT(*) AS n FROM messages WHERE session_id = ? AND role = 'user'",
    )
    .get(sessionId) as { n: number };
  return row.n;
}

export function touchSession(id: string): void {
  getDb()
    .prepare("UPDATE sessions SET updated_at = ? WHERE id = ?")
    .run(Date.now(), id);
}

export function deleteSession(id: string): void {
  const db = getDb();
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM vec_memories WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM memories WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM messages_fts WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM files WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM messages WHERE session_id = ?").run(id);
    db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  });
  transaction();
}

export function listAllSessionsForExport(): Session[] {
  const rows = getDb()
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) AS message_count
       FROM sessions s ORDER BY s.created_at ASC`,
    )
    .all() as SessionRow[];
  return rows.map(mapSession);
}
