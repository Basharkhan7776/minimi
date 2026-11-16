import { generateObject, type LanguageModel } from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb, getSetting } from "./db";
import { listReminders } from "./db/reminders";
import {
  deleteMemory,
  getMemory,
  insertMemory,
  listMemories,
  listMemoriesForReminder,
  listMemoryTexts,
  vectorSearch,
} from "./db/memories";
import { searchMessages } from "./db/messages";
import type { MemoryRecord, Reminder } from "./db/types";
import { embedPassages, embedQuery } from "./embeddings";
import { localDateString } from "./reminders/schedule";

export interface MemoryHit {
  id: string;
  text: string;
  kind: string;
  eventDate: string | null;
  sessionId: string;
  sessionTitle: string;
  createdAt: number;
  score: number;
}

const extractionSchema = z.object({
  memories: z
    .array(
      z.object({
        text: z
          .string()
          .describe(
            "One durable fact, preference, decision, list, or open commitment. Self-contained.",
          ),
        kind: z
          .enum(["fact", "preference", "decision", "task", "entity"])
          .default("fact"),
        eventDate: z
          .string()
          .optional()
          .describe("ISO date (YYYY-MM-DD) the event refers to, if known."),
      }),
    )
    .max(4),
});

function isoDate(ms: number): string {
  return localDateString(new Date(ms));
}

export async function saveMemories(
  memories: Array<{
    text: string;
    kind?: string;
    eventDate?: string | null;
    sessionId: string;
    messageId?: string | null;
  }>,
): Promise<number> {
  const clean = memories
    .map((memory) => ({ ...memory, text: memory.text.trim() }))
    .filter((memory) => memory.text.length >= 8);
  if (clean.length === 0) return 0;
  try {
    const embeddings = await embedPassages(clean.map((memory) => memory.text));
    let saved = 0;
    clean.forEach((memory, index) => {
      const embedding = embeddings[index];
      if (!embedding) return;
      insertMemory(
        {
          id: nanoid(12),
          sessionId: memory.sessionId,
          messageId: memory.messageId ?? null,
          kind: memory.kind ?? "fact",
          text: memory.text,
          eventDate: memory.eventDate ?? isoDate(Date.now()),
          createdAt: Date.now(),
        },
        embedding,
      );
      saved += 1;
    });
    return saved;
  } catch (error) {
    console.error("[memory] failed to save memories", error);
    return 0;
  }
}

export async function extractMemoriesForTurn(input: {
  model: LanguageModel;
  sessionId: string;
  messageId: string;
  userText: string;
  assistantText: string;
}): Promise<void> {
  if (getSetting("memory.autoExtract") === "0") return;
  if (getSetting("memory.enabled") === "0") return;
  try {
    const { object } = await generateObject({
      model: input.model,
      schema: extractionSchema,
      temperature: 0,
      system:
        "You extract durable memory from a conversation turn. Store only information that will be useful in future conversations: stable preferences, decisions, named entities, lists, dates, commitments, and corrections. Never store greetings, filler, generic knowledge, or the assistant's own reasoning. Never store a reminder schedule, time, or 'remind me' commitment; those are saved on the reminder itself. Each memory must be self-contained and understandable without the conversation. If nothing is worth remembering, return an empty list.",
      prompt: `Today is ${isoDate(Date.now())}.\n\nUser message:\n${input.userText.slice(0, 4000)}\n\nAssistant reply:\n${input.assistantText.slice(0, 6000)}\n\nExtract up to 4 durable memories.`,
    });

    await saveMemories(
      object.memories.map((memory) => ({
        text: memory.text,
        kind: memory.kind,
        eventDate: memory.eventDate ?? isoDate(Date.now()),
        sessionId: input.sessionId,
        messageId: input.messageId,
      })),
    );
    dropShadowReminderMemories(listReminders({ status: "active", limit: 100 }));
  } catch (error) {
    console.error("[memory] extraction failed", error);
  }
}

export async function recallMemories(options: {
  query: string;
  from?: string;
  to?: string;
  limit?: number;
}): Promise<MemoryHit[]> {
  const limit = options.limit ?? 10;
  const scores = new Map<string, MemoryHit>();

  const addScore = (hit: MemoryHit, score: number) => {
    const existing = scores.get(hit.id);
    if (existing) {
      existing.score += score;
    } else {
      scores.set(hit.id, { ...hit, score });
    }
  };

  if (options.query.trim()) {
    try {
      const embedding = await embedQuery(options.query);
      const vectorHits = vectorSearch(embedding, 24);
      vectorHits.forEach((hit, index) => {
        if (hit.eventDate && options.from && hit.eventDate < options.from) return;
        if (hit.eventDate && options.to && hit.eventDate > options.to) return;
        addScore(
          {
            id: hit.id,
            text: hit.text,
            kind: hit.kind,
            eventDate: hit.eventDate,
            sessionId: hit.sessionId,
            sessionTitle: "",
            createdAt: hit.createdAt,
            score: 0,
          },
          1 / (60 + index),
        );
      });
    } catch (error) {
      console.error("[memory] vector recall failed", error);
    }

    try {
      const ftsHits = searchMessages({
        query: toFtsQuery(options.query),
        from: options.from
          ? new Date(`${options.from}T00:00:00`).getTime()
          : undefined,
        to: options.to
          ? new Date(`${options.to}T23:59:59`).getTime()
          : undefined,
        limit: 24,
      });
      ftsHits.forEach((hit, index) => {
        addScore(
          {
            id: `msg:${hit.messageId}`,
            text: `${hit.role === "user" ? "User" : "Assistant"}: ${hit.content}`,
            kind: "turn",
            eventDate: isoDate(hit.createdAt),
            sessionId: hit.sessionId,
            sessionTitle: hit.title,
            createdAt: hit.createdAt,
            score: 0,
          },
          1 / (60 + index),
        );
      });
    } catch (error) {
      console.error("[memory] fts recall failed", error);
    }
  }

  if (options.from || options.to) {
    const db = getDb();
    const fromMs = options.from
      ? new Date(`${options.from}T00:00:00`).getTime()
      : 0;
    const toMs = options.to
      ? new Date(`${options.to}T23:59:59`).getTime()
      : Date.now();
    const rows = db
      .prepare(
        `SELECT m.id, m.content, m.created_at, m.role, s.id AS session_id, s.title
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         WHERE m.created_at BETWEEN ? AND ? AND m.role = 'user' AND m.content != ''
         ORDER BY m.created_at ASC
         LIMIT 60`,
      )
      .all(fromMs, toMs) as Array<{
      id: string;
      content: string;
      created_at: number;
      role: string;
      session_id: string;
      title: string;
    }>;
    rows.forEach((row, index) => {
      addScore(
        {
          id: `msg:${row.id}`,
          text: `User asked: ${row.content}`,
          kind: "turn",
          eventDate: isoDate(row.created_at),
          sessionId: row.session_id,
          sessionTitle: row.title,
          createdAt: row.created_at,
          score: 0,
        },
        1 / (40 + index),
      );
    });
  }

  const results = [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  for (const hit of results) {
    if (!hit.id.startsWith("msg:")) {
      const memory = getMemory(hit.id);
      if (memory) {
        hit.kind = memory.kind;
        if (!hit.createdAt) hit.createdAt = memory.createdAt;
        hit.eventDate = hit.eventDate ?? memory.eventDate;
      }
    }
    if (!hit.sessionTitle) {
      const session = getDb()
        .prepare("SELECT title FROM sessions WHERE id = ?")
        .get(hit.sessionId) as { title: string } | undefined;
      hit.sessionTitle = session?.title ?? hit.kind ?? "Memory";
    }
  }
  return results;
}

export async function rememberTurn(input: {
  sessionId: string;
  messageId: string;
  userText: string;
  assistantText: string;
}): Promise<void> {
  await saveMemories([
    {
      text: `On ${isoDate(Date.now())}, the user asked: ${input.userText.slice(0, 500)}`,
      kind: "turn",
      eventDate: isoDate(Date.now()),
      sessionId: input.sessionId,
      messageId: input.messageId,
    },
  ]);
}

export function memoryStats(): {
  memories: number;
  messages: number;
  sessions: number;
  embeddingEnabled: boolean;
} {
  const db = getDb();
  const memories = (
    db.prepare("SELECT COUNT(*) AS n FROM memories").get() as { n: number }
  ).n;
  const messages = (
    db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number }
  ).n;
  const sessions = (
    db.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }
  ).n;
  return {
    memories,
    messages,
    sessions,
    embeddingEnabled: getSetting("memory.enabled") !== "0",
  };
}

export async function rebuildMemories(): Promise<number> {
  const db = getDb();
  db.prepare("DELETE FROM vec_memories").run();
  db.prepare("DELETE FROM memories").run();

  const rows = db
    .prepare(
      `SELECT m.id, m.session_id, m.role, m.content, m.created_at
       FROM messages m
       WHERE m.content != '' AND m.role = 'user'
       ORDER BY m.created_at ASC
       LIMIT 500`,
    )
    .all() as Array<{
    id: string;
    session_id: string;
    role: string;
    content: string;
    created_at: number;
  }>;

  let count = 0;
  for (const row of rows) {
    const text = `User asked: ${row.content.slice(0, 1200)}`;
    try {
      const [embedding] = await embedPassages([text]);
      if (!embedding) continue;
      insertMemory(
        {
          id: nanoid(12),
          sessionId: row.session_id,
          messageId: row.id,
          kind: "turn",
          text,
          eventDate: isoDate(row.created_at),
          createdAt: row.created_at,
        },
        embedding,
      );
      count += 1;
    } catch (error) {
      console.error("[memory] rebuild failed for message", row.id, error);
      break;
    }
  }
  return count;
}

export function reminderMemoryText(reminder: Reminder): string {
  const when = reminder.dueTime
    ? `${reminder.dueDate} at ${reminder.dueTime}`
    : `${reminder.dueDate}, all day`;
  const notes = reminder.notes?.trim() ? ` ${reminder.notes.trim()}` : "";
  const url = reminder.url ? ` ${reminder.url}` : "";
  return `Reminder: ${reminder.title} — ${when}.${notes}${url}`.replace(/\s+/g, " ").trim();
}

function writeReminderMemory(reminder: Reminder, memoryId: string, createdAt: number, embedding: number[] | null): void {
  const text = reminderMemoryText(reminder);
  const record: MemoryRecord = {
    id: memoryId,
    sessionId: reminder.sessionId || "reminders",
    messageId: reminder.sourceMessageId,
    kind: "task",
    text,
    eventDate: reminder.dueDate,
    createdAt,
    reminderId: reminder.id,
  };
  if (embedding) {
    insertMemory(record, embedding);
    return;
  }
  const db = getDb();
  db.prepare(
    `INSERT OR REPLACE INTO memories
      (id, session_id, message_id, kind, text, event_date, created_at, reminder_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    record.id,
    record.sessionId,
    record.messageId,
    record.kind,
    record.text,
    record.eventDate,
    record.createdAt,
    record.reminderId ?? null,
  );
  db.prepare("DELETE FROM vec_memories WHERE memory_id = ?").run(record.id);
}

export function dropStaleReminderMemories(
  titles: Array<string | null | undefined>,
  keepId: string | null,
): void {
  const needles = [
    ...new Set(
      titles
        .map((title) => title?.trim().toLowerCase() ?? "")
        .filter((title) => title.length >= 4),
    ),
  ];
  if (needles.length === 0) return;
  for (const memory of listMemoryTexts()) {
    if (memory.id === keepId || memory.reminderId) continue;
    const text = memory.text.toLowerCase();
    const mentions = needles.some((needle) => text.includes(needle));
    if (!mentions) continue;
    const looksLikeReminder = memory.kind === "task" || text.includes("remind");
    if (!looksLikeReminder) continue;
    deleteMemory(memory.id);
  }
}

function dropShadowReminderMemories(reminders: Reminder[]): void {
  for (const reminder of reminders) {
    const linked = listMemoriesForReminder(reminder.id);
    dropStaleReminderMemories(
      [reminder.title],
      linked[0]?.id ?? null,
    );
  }
}

export async function syncReminderMemory(
  reminder: Reminder,
  previous?: Pick<Reminder, "title"> | null,
): Promise<void> {
  const linked = listMemoriesForReminder(reminder.id);
  if (reminder.status !== "active") {
    for (const memory of linked) deleteMemory(memory.id);
    dropStaleReminderMemories([reminder.title, previous?.title], null);
    return;
  }

  const keep = linked[0];
  for (const extra of linked.slice(1)) deleteMemory(extra.id);
  const memoryId = keep?.id ?? nanoid(12);
  let embedding: number[] | null = null;
  if (process.env.MINIMI_SKIP_EMBED !== "1") {
    try {
      const [vector] = await embedPassages([reminderMemoryText(reminder)]);
      embedding = vector ?? null;
    } catch (error) {
      console.error("[memory] reminder embed failed", error);
    }
  }
  writeReminderMemory(reminder, memoryId, keep?.createdAt ?? Date.now(), embedding);
  dropStaleReminderMemories([reminder.title, previous?.title], memoryId);
}

export { listMemories };

function toFtsQuery(query: string): string {
  const tokens = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .slice(0, 8);
  if (tokens.length === 0) return query.replace(/["']/g, "");
  return tokens.map((token) => `"${token}"`).join(" OR ");
}
