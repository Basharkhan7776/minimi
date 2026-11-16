import {
  fireDueEvents,
  syncAllActiveReminderEvents,
} from "../db/reminders";

export const REMINDER_TICK_MS = 15 * 60_000;

export function runReminderTick(now = Date.now()): number {
  return fireDueEvents(now);
}

export function startReminderScheduler(): () => void {
  const timer = setInterval(() => {
    try {
      runReminderTick();
    } catch (error) {
      console.error("[reminders] scheduler tick failed", error);
    }
  }, REMINDER_TICK_MS);
  timer.unref?.();
  syncAllActiveReminderEvents();
  runReminderTick();
  return () => clearInterval(timer);
}
