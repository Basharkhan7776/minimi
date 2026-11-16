import {
  createReminder,
  findActiveReminder,
} from "../db/reminders";
import type { Reminder } from "../db/types";
import {
  validateReminderInput,
  type ReminderInput,
} from "./schedule";

export interface CreateReminderResult {
  ok: boolean;
  reminder?: Reminder;
  error?: string;
  duplicate?: boolean;
}

export function createReminderFromInput(input: {
  reminder: ReminderInput;
  sessionId?: string | null;
  sourceMessageId?: string | null;
}): CreateReminderResult {
  const validated = validateReminderInput(input.reminder);
  if (!validated.ok) return { ok: false, error: validated.error };
  const clean = validated.input;

  if (input.sessionId) {
    const existing = findActiveReminder({
      sessionId: input.sessionId,
      title: clean.title,
      dueDate: clean.dueDate,
      dueTime: clean.dueTime ?? null,
    });
    if (existing) return { ok: true, reminder: existing, duplicate: true };
  }

  const reminder = createReminder({
    sessionId: input.sessionId,
    title: clean.title,
    notes: clean.notes,
    url: clean.url,
    dueDate: clean.dueDate,
    dueTime: clean.dueTime,
    timezone: clean.timezone,
    sourceMessageId: input.sourceMessageId,
  });
  return { ok: true, reminder };
}
