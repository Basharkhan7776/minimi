import { getDb } from "./index";
import type { MemoryRecord } from "./types";

interface MemoryRow {
  id: string;
  session_id: string;
  message_id: string | null;
  kind: string;
  text: string;
  event_date: string | null;
  created_at: number;
  reminder_id?: string | null;
}

function mapMemory(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    kind: row.kind,
    text: row.text,
    eventDate: row.event_date,
    createdAt: row.created_at,
    reminderId: row.reminder_id ?? null,
  };
}

export function insertMemory(
  memory: MemoryRecord,
  embedding: number[],
): void {
  const db = getDb();
  const transaction = db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO memories
        (id, session_id, message_id, kind, text, event_date, created_at, reminder_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      memory.id,
      memory.sessionId,
      memory.messageId,
      memory.kind,
      memory.text,
      memory.eventDate,
      memory.createdAt,
      memory.reminderId ?? null,
    );
    db.prepare("DELETE FROM vec_memories WHERE memory_id = ?").run(memory.id);
    db.prepare(
      `INSERT INTO vec_memories
        (memory_id, embedding, session_id, message_id, event_date, text)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      memory.id,
      JSON.stringify(embedding),
      memory.sessionId,
      memory.messageId,
      memory.eventDate,
      memory.text,
    );
  });
  transaction();
}

export function listMemories(limit = 100): MemoryRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM memories ORDER BY created_at DESC LIMIT ?")
    .all(limit) as MemoryRow[];
  return rows.map(mapMemory);
}

export function countMemories(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM memories").get() as {
    n: number;
  };
  return row.n;
}

export function deleteMemory(id: string): void {
  const db = getDb();
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM vec_memories WHERE memory_id = ?").run(id);
    db.prepare("DELETE FROM memories WHERE id = ?").run(id);
  });
  transaction();
}

export function deleteAllMemories(): void {
  const db = getDb();
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM vec_memories").run();
    db.prepare("DELETE FROM memories").run();
  });
  transaction();
}

export function vectorSearch(
  embedding: number[],
  limit = 20,
): Array<MemoryRecord & { distance: number }> {
  const rows = getDb()
    .prepare(
      `SELECT memory_id, distance, session_id, message_id, event_date, text
       FROM vec_memories
       WHERE embedding MATCH ? AND k = ?
       ORDER BY distance ASC`,
    )
    .all(JSON.stringify(embedding), limit) as Array<{
    memory_id: string;
    distance: number;
    session_id: string;
    message_id: string | null;
    event_date: string | null;
    text: string;
  }>;

  return rows.map((row) => ({
    id: row.memory_id,
    sessionId: row.session_id,
    messageId: row.message_id,
    kind: "fact",
    text: row.text,
    eventDate: row.event_date,
    createdAt: 0,
    distance: row.distance,
  }));
}

export function listMemoriesForReminder(reminderId: string): MemoryRecord[] {
  const rows = getDb()
    .prepare("SELECT * FROM memories WHERE reminder_id = ?")
    .all(reminderId) as MemoryRow[];
  return rows.map(mapMemory);
}

export function listMemoryTexts(): Array<{
  id: string;
  text: string;
  kind: string;
  reminderId: string | null;
}> {
  const rows = getDb()
    .prepare("SELECT id, text, kind, reminder_id FROM memories")
    .all() as Array<{
    id: string;
    text: string;
    kind: string;
    reminder_id: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    kind: row.kind,
    reminderId: row.reminder_id,
  }));
}

export function getMemory(id: string): MemoryRecord | null {
  const row = getDb()
    .prepare("SELECT * FROM memories WHERE id = ?")
    .get(id) as MemoryRow | undefined;
  return row ? mapMemory(row) : null;
}
