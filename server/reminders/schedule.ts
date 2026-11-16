export const DAY_START_HOUR = 9;
export const DAY_END_HOUR = 21;
export const DAY_INTERVAL_HOURS = 2;

export interface ReminderInput {
  title: string;
  dueDate: string;
  dueTime?: string | null;
  notes?: string | null;
  url?: string | null;
  timezone?: string | null;
}

export function isDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function isTimeString(value: string): boolean {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(":").map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

export function localDateString(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function localTimeString(date = new Date()): string {
  return [
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
  ].join(":");
}

export function parseLocalDateTime(
  dueDate: string,
  dueTime?: string | null,
): Date | null {
  if (!isDateString(dueDate)) return null;
  const [year, month, day] = dueDate.split("-").map(Number);
  if (dueTime) {
    if (!isTimeString(dueTime)) return null;
    const [hour, minute] = dueTime.split(":").map(Number);
    return new Date(year, month - 1, day, hour, minute, 0, 0);
  }
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

export function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeUrl(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return isValidUrl(trimmed) ? trimmed : null;
}

export function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"')\]]+/i);
  if (!match) return null;
  return normalizeUrl(match[0].replace(/[.,;:!?]+$/, ""));
}

export function validateReminderInput(
  input: ReminderInput,
  options?: { allowPast?: boolean },
):
  | { ok: true; input: ReminderInput }
  | { ok: false; error: string } {
  const title = input.title.trim().slice(0, 160);
  if (title.length < 2) return { ok: false, error: "Reminder title is too short." };
  if (!isDateString(input.dueDate)) {
    return { ok: false, error: "dueDate must be YYYY-MM-DD." };
  }
  if (input.dueTime && !isTimeString(input.dueTime)) {
    return { ok: false, error: "dueTime must be HH:MM." };
  }
  if (!options?.allowPast) {
    const due = parseLocalDateTime(input.dueDate, input.dueTime);
    const past = input.dueTime
      ? !due || due.getTime() < Date.now() - 60_000
      : input.dueDate < localDateString();
    if (past) {
      return { ok: false, error: "Reminder date is in the past." };
    }
  }
  return {
    ok: true,
    input: {
      ...input,
      title,
      dueTime: input.dueTime || null,
      notes: input.notes?.trim() || null,
      url: normalizeUrl(input.url),
      timezone:
        input.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
  };
}

export interface ScheduledEvent {
  kind: "day_hour" | "time_pre" | "time_due" | "time_post";
  scheduledFor: number;
}

export function buildReminderSchedule(input: {
  dueDate: string;
  dueTime: string | null;
  createdAt: number;
}): ScheduledEvent[] {
  const target = parseLocalDateTime(input.dueDate, input.dueTime);
  if (!target) return [];

  if (input.dueTime) {
    return target.getTime() >= input.createdAt
      ? [{ kind: "time_due" as const, scheduledFor: target.getTime() }]
      : [];
  }

  const [year, month, day] = input.dueDate.split("-").map(Number);
  const events: ScheduledEvent[] = [];
  for (
    let hour = DAY_START_HOUR;
    hour <= DAY_END_HOUR;
    hour += DAY_INTERVAL_HOURS
  ) {
    const scheduledFor = new Date(year, month - 1, day, hour, 0, 0, 0).getTime();
    if (scheduledFor >= input.createdAt) {
      events.push({ kind: "day_hour", scheduledFor });
    }
  }
  return events;
}

export function formatDueLabel(dueDate: string, dueTime: string | null): string {
  const today = localDateString();
  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrow = localDateString(tomorrowDate);

  const day =
    dueDate === today
      ? "Today"
      : dueDate === tomorrow
        ? "Tomorrow"
        : new Date(`${dueDate}T12:00:00`).toLocaleDateString(undefined, {
            day: "numeric",
            month: "short",
          });
  return dueTime ? `${day} ${dueTime}` : day;
}
