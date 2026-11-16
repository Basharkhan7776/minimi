import { nanoid } from "nanoid";
import { getDb } from "./index";
import type { Reminder, ReminderEvent } from "./types";
import {
  buildReminderSchedule,
  type ReminderInput,
} from "../reminders/schedule";

interface ReminderRow {
  id: string;
  session_id: string | null;
  title: string;
  notes: string | null;
  url: string | null;
  due_date: string;
  due_time: string | null;
  timezone: string | null;
  status: "active" | "done";
  source_message_id: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
  next_nudge_at?: number | null;
  event_count?: number;
}

interface EventRow {
  id: string;
  reminder_id: string;
  kind: string;
  scheduled_for: number;
  status: ReminderEvent["status"];
  fired_at: number | null;
  notified_at: number | null;
  created_at: number;
  reminder_title?: string;
  session_id?: string | null;
}

function mapReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    notes: row.notes,
    url: row.url,
    dueDate: row.due_date,
    dueTime: row.due_time,
    timezone: row.timezone,
    status: row.status,
    sourceMessageId: row.source_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    nextNudgeAt: row.next_nudge_at ?? null,
    eventCount: row.event_count ?? 0,
  };
}

function mapEvent(row: EventRow): ReminderEvent {
  return {
    id: row.id,
    reminderId: row.reminder_id,
    kind: row.kind,
    scheduledFor: row.scheduled_for,
    status: row.status,
    firedAt: row.fired_at,
    notifiedAt: row.notified_at,
    createdAt: row.created_at,
    reminderTitle: row.reminder_title,
    sessionId: row.session_id ?? null,
  };
}

const SELECT_REMINDER = `
  SELECT r.*,
    (SELECT MIN(e.scheduled_for) FROM reminder_events e
      WHERE e.reminder_id = r.id AND e.status = 'pending') AS next_nudge_at,
    (SELECT COUNT(*) FROM reminder_events e WHERE e.reminder_id = r.id) AS event_count
  FROM reminders r
`;

export function createReminder(input: {
  sessionId?: string | null;
  title: string;
  notes?: string | null;
  url?: string | null;
  dueDate: string;
  dueTime?: string | null;
  timezone?: string | null;
  sourceMessageId?: string | null;
}): Reminder {
  const db = getDb();
  const now = Date.now();
  const id = nanoid(12);
  db.prepare(
    `INSERT INTO reminders
      (id, session_id, title, notes, url, due_date, due_time, timezone, status,
       source_message_id, created_at, updated_at, completed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL)`,
  ).run(
    id,
    input.sessionId ?? null,
    input.title,
    input.notes ?? null,
    input.url ?? null,
    input.dueDate,
    input.dueTime ?? null,
    input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    input.sourceMessageId ?? null,
    now,
    now,
  );
  syncReminderEvents(id);
  return getReminder(id)!;
}

export function getReminder(id: string): Reminder | null {
  const row = getDb()
    .prepare(`${SELECT_REMINDER} WHERE r.id = ?`)
    .get(id) as ReminderRow | undefined;
  return row ? mapReminder(row) : null;
}

export function listReminders(options?: {
  status?: "active" | "done";
  sessionId?: string;
  limit?: number;
}): Reminder[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (options?.status) {
    clauses.push("r.status = ?");
    params.push(options.status);
  }
  if (options?.sessionId) {
    clauses.push("r.session_id = ?");
    params.push(options.sessionId);
  }
  params.push(options?.limit ?? 100);
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDb()
    .prepare(
      `${SELECT_REMINDER} ${where}
       ORDER BY r.due_date ASC, COALESCE(r.due_time, '00:00') ASC, r.created_at ASC
       LIMIT ?`,
    )
    .all(...params) as ReminderRow[];
  return rows.map(mapReminder);
}

export function updateReminder(
  id: string,
  patch: Partial<{
    title: string;
    notes: string | null;
    url: string | null;
    dueDate: string;
    dueTime: string | null;
    timezone: string | null;
    status: "active" | "done";
  }>,
): Reminder | null {
  const existing = getReminder(id);
  if (!existing) return null;

  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.title !== undefined) {
    fields.push("title = ?");
    values.push(patch.title.trim() || existing.title);
  }
  if (patch.notes !== undefined) {
    fields.push("notes = ?");
    values.push(patch.notes);
  }
  if (patch.url !== undefined) {
    fields.push("url = ?");
    values.push(patch.url);
  }
  if (patch.dueDate !== undefined) {
    fields.push("due_date = ?");
    values.push(patch.dueDate);
  }
  if (patch.dueTime !== undefined) {
    fields.push("due_time = ?");
    values.push(patch.dueTime);
  }
  if (patch.timezone !== undefined) {
    fields.push("timezone = ?");
    values.push(patch.timezone);
  }
  if (patch.status !== undefined) {
    fields.push("status = ?");
    values.push(patch.status);
    fields.push("completed_at = ?");
    values.push(patch.status === "done" ? Date.now() : null);
  }
  fields.push("updated_at = ?");
  values.push(Date.now(), id);

  getDb()
    .prepare(`UPDATE reminders SET ${fields.join(", ")} WHERE id = ?`)
    .run(...values);

  if (patch.status === "done") cancelPendingEvents(id);
  else if (
    patch.dueDate !== undefined ||
    patch.dueTime !== undefined ||
    patch.status === "active"
  ) {
    syncReminderEvents(id);
  }
  return getReminder(id);
}

export function deleteReminder(id: string): void {
  getDb().prepare("DELETE FROM reminders WHERE id = ?").run(id);
}

export function findActiveReminder(input: {
  sessionId: string;
  title: string;
  dueDate: string;
  dueTime: string | null;
}): Reminder | null {
  const row = getDb()
    .prepare(
      `${SELECT_REMINDER}
       WHERE r.session_id = ? AND r.status = 'active' AND lower(r.title) = lower(?)
         AND r.due_date = ? AND COALESCE(r.due_time, '') = COALESCE(?, '')
       LIMIT 1`,
    )
    .get(input.sessionId, input.title, input.dueDate, input.dueTime) as
    | ReminderRow
    | undefined;
  return row ? mapReminder(row) : null;
}

export function hasReminderForMessage(messageId: string): boolean {
  const row = getDb()
    .prepare(
      "SELECT 1 FROM reminders WHERE source_message_id = ? AND status = 'active' LIMIT 1",
    )
    .get(messageId);
  return Boolean(row);
}

export function syncReminderEvents(reminderId: string): void {
  const reminder = getReminder(reminderId);
  if (!reminder) return;
  if (reminder.status !== "active") {
    cancelPendingEvents(reminderId);
    return;
  }
  const events = buildReminderSchedule({
    dueDate: reminder.dueDate,
    dueTime: reminder.dueTime,
    createdAt: reminder.createdAt,
  });
  const db = getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO reminder_events
      (id, reminder_id, kind, scheduled_for, status, fired_at, notified_at, created_at)
     VALUES (?, ?, ?, ?, 'pending', NULL, NULL, ?)`,
  );
  const transaction = db.transaction(() => {
    db.prepare(
      "DELETE FROM reminder_events WHERE reminder_id = ? AND status = 'pending'",
    ).run(reminderId);
    for (const event of events) {
      insert.run(
        nanoid(12),
        reminderId,
        event.kind,
        event.scheduledFor,
        Date.now(),
      );
    }
  });
  transaction();
}

export function syncAllActiveReminderEvents(): void {
  const rows = getDb()
    .prepare("SELECT id FROM reminders WHERE status = 'active'")
    .all() as Array<{ id: string }>;
  for (const row of rows) syncReminderEvents(row.id);
}

export function cancelPendingEvents(reminderId: string): void {
  getDb()
    .prepare(
      "UPDATE reminder_events SET status = 'cancelled' WHERE reminder_id = ? AND status = 'pending'",
    )
    .run(reminderId);
}

export function fireDueEvents(
  now = Date.now(),
  graceMs = 30 * 60_000,
): number {
  const db = getDb();
  const transaction = db.transaction(() => {
    db.prepare(
      `UPDATE reminder_events
       SET status = 'skipped'
       WHERE status = 'pending' AND scheduled_for < ?
         AND reminder_id IN (SELECT id FROM reminders WHERE status = 'active')`,
    ).run(now - graceMs);
    const result = db
      .prepare(
        `UPDATE reminder_events
         SET status = 'fired', fired_at = ?
         WHERE status = 'pending' AND scheduled_for <= ?
           AND reminder_id IN (SELECT id FROM reminders WHERE status = 'active')`,
      )
      .run(now, now);
    return result.changes;
  });
  return transaction();
}

export function claimPendingNotifications(
  now = Date.now(),
  graceMs = 10 * 60_000,
): ReminderEvent[] {
  const db = getDb();
  const transaction = db.transaction(() => {
    const rows = db
      .prepare(
        `SELECT e.*, r.title AS reminder_title, r.session_id
         FROM reminder_events e
         JOIN reminders r ON r.id = e.reminder_id
         WHERE e.status = 'fired' AND e.notified_at IS NULL
           AND e.fired_at >= ? AND r.status = 'active'
         ORDER BY e.fired_at ASC, e.scheduled_for ASC`,
      )
      .all(now - graceMs) as EventRow[];
    if (rows.length > 0) {
      const mark = db.prepare(
        "UPDATE reminder_events SET notified_at = ? WHERE id = ?",
      );
      for (const row of rows) mark.run(now, row.id);
    }
    return rows;
  });
  return transaction().map(mapEvent);
}

export function listEventsForReminder(reminderId: string): ReminderEvent[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM reminder_events WHERE reminder_id = ? ORDER BY scheduled_for ASC",
    )
    .all(reminderId) as EventRow[];
  return rows.map(mapEvent);
}

export function listAllRemindersForExport(): Reminder[] {
  const rows = getDb()
    .prepare(`${SELECT_REMINDER} ORDER BY r.created_at ASC`)
    .all() as ReminderRow[];
  return rows.map(mapReminder);
}

export function listAllEventsForExport(): ReminderEvent[] {
  const rows = getDb()
    .prepare("SELECT * FROM reminder_events ORDER BY scheduled_for ASC")
    .all() as EventRow[];
  return rows.map(mapEvent);
}

export function countReminders(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM reminders WHERE status = 'active'")
    .get() as { n: number };
  return row.n;
}

export type { ReminderInput };
