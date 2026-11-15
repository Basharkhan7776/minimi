import { getDb } from "./index";
import type { FileRecord } from "./types";

interface FileRow {
  id: string;
  session_id: string | null;
  message_id: string | null;
  name: string;
  mime: string;
  size: number;
  path: string;
  extracted_text: string | null;
  created_at: number;
}

function mapFile(row: FileRow): FileRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    path: row.path,
    extractedText: row.extracted_text,
    createdAt: row.created_at,
  };
}

export function createFileRecord(input: {
  id: string;
  sessionId?: string | null;
  messageId?: string | null;
  name: string;
  mime: string;
  size: number;
  path: string;
  extractedText?: string | null;
}): FileRecord {
  getDb()
    .prepare(
      `INSERT INTO files (id, session_id, message_id, name, mime, size, path, extracted_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.id,
      input.sessionId ?? null,
      input.messageId ?? null,
      input.name,
      input.mime,
      input.size,
      input.path,
      input.extractedText ?? null,
      Date.now(),
    );
  return getFileRecord(input.id)!;
}

export function getFileRecord(id: string): FileRecord | null {
  const row = getDb()
    .prepare("SELECT * FROM files WHERE id = ?")
    .get(id) as FileRow | undefined;
  return row ? mapFile(row) : null;
}

export function getFilesByIds(ids: string[]): FileRecord[] {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const rows = getDb()
    .prepare(`SELECT * FROM files WHERE id IN (${placeholders})`)
    .all(...ids) as FileRow[];
  return rows.map(mapFile);
}

export function listFilesForSession(sessionId: string): FileRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM files WHERE session_id = ? ORDER BY created_at ASC")
    .all(sessionId) as FileRow[];
  return rows.map(mapFile);
}

export function deleteFileRecord(id: string): void {
  getDb().prepare("DELETE FROM files WHERE id = ?").run(id);
}
