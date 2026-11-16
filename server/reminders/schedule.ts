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

function formatClock(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** A blank value means all day. A clock time becomes 24-hour HH:MM. */
export function normalizeClockTime(
  value?: string | null,
): { ok: true; time: string | null } | { ok: false; error: string } {
  if (value == null) return { ok: true, time: null };
  const trimmed = value.trim().toLowerCase().replace(/\./g, "");
  if (
    !trimmed ||
    trimmed === "all day" ||
    trimmed === "all-day" ||
    trimmed === "anytime"
  ) {
    return { ok: true, time: null };
  }
  if (trimmed === "noon") return { ok: true, time: "12:00" };
  if (trimmed === "midnight") return { ok: true, time: "00:00" };

  const clockError = "dueTime must be a clock time like 15:30 or 3:30 pm.";
  const ampm = trimmed.match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)$/);
  if (ampm) {
    let hour = Number(ampm[1]);
    const minute = Number(ampm[2] ?? "0");
    if (hour < 1 || hour > 12 || minute > 59) {
      return { ok: false, error: clockError };
    }
    if (ampm[3] === "am") hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
    return { ok: true, time: formatClock(hour, minute) };
  }

  const hm = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (hm) {
    const hour = Number(hm[1]);
    const minute = Number(hm[2]);
    if (hour > 23 || minute > 59) return { ok: false, error: clockError };
    return { ok: true, time: formatClock(hour, minute) };
  }

  return { ok: false, error: clockError };
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
  const clock = normalizeClockTime(input.dueTime);
  if (!clock.ok) return clock;
  const rawUrl = input.url?.trim() ?? "";
  if (rawUrl && !isValidUrl(rawUrl)) {
    return { ok: false, error: "URL must start with http:// or https://." };
  }
  if (!options?.allowPast) {
    const due = parseLocalDateTime(input.dueDate, clock.time);
    const past = clock.time
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
      dueTime: clock.time,
      notes: input.notes?.trim() || null,
      url: rawUrl || null,
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
  const clock = normalizeClockTime(input.dueTime);
  if (!clock.ok) return [];
  const dueTime = clock.time;
  const target = parseLocalDateTime(input.dueDate, dueTime);
  if (!target) return [];

  if (dueTime) {
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
  return dueTime ? `${day} ${dueTime}` : `${day} · all day`;
}
