import {
  createReminder,
  deleteReminder,
  getReminder,
  listReminders,
  updateReminder,
  findActiveReminder,
} from "../db/reminders";
import type { Reminder } from "../db/types";
import { syncReminderMemory } from "../memory";
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

export async function createReminderFromInput(input: {
  reminder: ReminderInput;
  sessionId?: string | null;
  sourceMessageId?: string | null;
}): Promise<CreateReminderResult> {
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
    if (existing) {
      await syncReminderMemory(existing);
      return { ok: true, reminder: existing, duplicate: true };
    }
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
  if ((reminder.eventCount ?? 0) === 0) {
    deleteReminder(reminder.id);
    return {
      ok: false,
      error: clean.dueTime
        ? "That time has already passed."
        : "That date has no all-day reminder times left. Add a time or pick a later date.",
    };
  }
  await syncReminderMemory(reminder);
  return { ok: true, reminder };
}

export interface ReminderPatch {
  title?: string;
  dueDate?: string;
  dueTime?: string | null;
  notes?: string | null;
  url?: string | null;
  status?: "active" | "done";
}

function resolveReminder(idOrTitle: string): Reminder | Reminder[] | null {
  const needle = idOrTitle.trim();
  if (!needle) return null;
  const byId = getReminder(needle);
  if (byId) return byId;
  const active = listReminders({ status: "active", limit: 100 });
  const lowered = needle.toLowerCase();
  const exact = active.filter((reminder) => reminder.title.toLowerCase() === lowered);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return exact;
  const partial = active.filter((reminder) => {
    const title = reminder.title.toLowerCase();
    return title.includes(lowered) || lowered.includes(title);
  });
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) return partial;
  return null;
}

export async function updateReminderFromInput(input: {
  id: string;
  patch: ReminderPatch;
}): Promise<CreateReminderResult> {
  const resolved = resolveReminder(input.id);
  if (!resolved) return { ok: false, error: "No reminder matched that id or title." };
  if (Array.isArray(resolved)) {
    return {
      ok: false,
      error: `Several reminders match. Use an id: ${resolved
        .map((reminder) => `${reminder.id} (${reminder.title})`)
        .join("; ")}`,
    };
  }
  const existing = resolved;
  const patch = input.patch;
  const hasChange = Object.values(patch).some((value) => value !== undefined);
  if (!hasChange) {
    await syncReminderMemory(existing);
    return { ok: true, reminder: existing };
  }

  const nextStatus = patch.status ?? existing.status;
  const dueTimeProvided = typeof patch.dueTime === "string";
  const validated = validateReminderInput(
    {
      title: patch.title ?? existing.title,
      dueDate: patch.dueDate ?? existing.dueDate,
      dueTime: dueTimeProvided ? patch.dueTime : existing.dueTime,
      notes: patch.notes !== undefined ? patch.notes : existing.notes,
      url: patch.url !== undefined ? patch.url : existing.url,
      timezone: existing.timezone,
    },
    { allowPast: nextStatus === "done" },
  );
  if (!validated.ok) return { ok: false, error: validated.error };

  const reminder = updateReminder(existing.id, {
    ...(patch.title !== undefined ? { title: validated.input.title } : {}),
    ...(patch.dueDate !== undefined ? { dueDate: validated.input.dueDate } : {}),
    ...(dueTimeProvided ? { dueTime: validated.input.dueTime ?? null } : {}),
    ...(patch.notes !== undefined ? { notes: validated.input.notes ?? null } : {}),
    ...(patch.url !== undefined ? { url: validated.input.url ?? null } : {}),
    ...(patch.status !== undefined ? { status: patch.status } : {}),
  });
  if (!reminder) return { ok: false, error: "Could not update that reminder." };
  if (reminder.status === "active" && (reminder.eventCount ?? 0) === 0) {
    updateReminder(existing.id, {
      title: existing.title,
      notes: existing.notes,
      url: existing.url,
      dueDate: existing.dueDate,
      dueTime: existing.dueTime,
      timezone: existing.timezone,
      status: existing.status,
    });
    return {
      ok: false,
      error: validated.input.dueTime
        ? "That time has already passed."
        : "That date has no all-day reminder times left. Add a time or pick a later date.",
    };
  }
  await syncReminderMemory(reminder, existing);
  return { ok: true, reminder };
}
