import { format, isToday, isTomorrow } from "date-fns";
import type { Reminder, ReminderEvent } from "./types";

export function localDateString(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function formatReminderDue(reminder: Reminder): string {
  const due = new Date(`${reminder.dueDate}T12:00:00`);
  const day = isToday(due)
    ? "Today"
    : isTomorrow(due)
      ? "Tomorrow"
      : format(due, "d MMM");
  return reminder.dueTime ? `${day} ${reminder.dueTime}` : `${day} · all day`;
}

export function isReminderOverdue(reminder: Reminder, now = Date.now()): boolean {
  if (reminder.status !== "active") return false;
  const due = new Date(
    `${reminder.dueDate}T${reminder.dueTime ?? "23:59"}:00`,
  );
  return due.getTime() < now && !reminder.dueTime
    ? reminder.dueDate < localDateString()
    : due.getTime() < now;
}

export function activeReminders(reminders: Reminder[]): Reminder[] {
  return reminders
    .filter((reminder) => reminder.status === "active")
    .sort((a, b) =>
      `${a.dueDate} ${a.dueTime ?? "00:00"}`.localeCompare(
        `${b.dueDate} ${b.dueTime ?? "00:00"}`,
      ),
    );
}

export function doneReminders(reminders: Reminder[]): Reminder[] {
  return reminders
    .filter((reminder) => reminder.status === "done")
    .sort((a, b) =>
      `${b.dueDate} ${b.dueTime ?? "00:00"}`.localeCompare(
        `${a.dueDate} ${a.dueTime ?? "00:00"}`,
      ),
    );
}

export function nextNudgeLabel(reminder: Reminder): string | null {
  if (!reminder.nextNudgeAt) return null;
  const date = new Date(reminder.nextNudgeAt);
  if (date.getTime() < Date.now()) return null;
  return isToday(date)
    ? `Next nudge ${format(date, "HH:mm")}`
    : `Next nudge ${format(date, "d MMM HH:mm")}`;
}

export function nudgeBody(event: ReminderEvent): string {
  switch (event.kind) {
    case "time_pre":
      return "Starts in 30 minutes.";
    case "time_due":
      return "This is due now.";
    case "time_post":
      return "Still pending — 30 minutes past the target time.";
    default:
      return "Scheduled for today. Open Minimi to mark it done.";
  }
}
