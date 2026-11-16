import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { extractFirstUrl, localDateString } from "./schedule";
import { createReminderFromInput } from "./service";
import type { Reminder } from "../db/types";

const reminderSchema = z.object({
  reminder: z
    .object({
      title: z
        .string()
        .describe("Short action title, e.g. 'Email HR at Acme about the interview'."),
      dueDate: z.string().describe("Local date in YYYY-MM-DD format."),
      dueTime: z
        .string()
        .nullable()
        .optional()
        .describe("Local 24-hour time HH:MM, or null for an all-day reminder."),
      url: z
        .string()
        .nullable()
        .optional()
        .describe("A website URL mentioned by the user, or null."),
      notes: z.string().nullable().optional(),
    })
    .nullable(),
});

const REMINDER_TRIGGER =
  /\b(remind me|remember to|don'?t forget|don’t forget|set a reminder|schedule (?:a |an |the )?|follow up|i (?:will|need to|have to) (?:mail|email|call|send|pay|book|submit|finish|do|follow))\b/i;

export function shouldExtractReminder(userText: string): boolean {
  return REMINDER_TRIGGER.test(userText);
}

export async function extractReminderForTurn(input: {
  model: LanguageModel;
  sessionId: string;
  messageId: string;
  userText: string;
}): Promise<Reminder | null> {
  if (!shouldExtractReminder(input.userText)) return null;
  try {
    const now = new Date();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const { object } = await generateObject({
      model: input.model,
      schema: reminderSchema,
      temperature: 0,
      abortSignal: AbortSignal.timeout(15000),
      system:
        "You extract a single future reminder from a user message. Only create a reminder when the user explicitly commits to doing something later or asks to be reminded. Resolve relative dates using the supplied current local date and time. Use YYYY-MM-DD and 24-hour HH:MM. If no clear future commitment exists, return reminder: null. Never invent a date or time.",
      prompt: `Current local date: ${localDateString(now)}\nCurrent local time: ${now.toLocaleTimeString("en-GB", { hour12: false })}\nTimezone: ${timezone}\n\nUser message:\n${input.userText.slice(0, 4000)}\n\nExtract the reminder. If a URL appears in the message, include it.`,
    });

    if (!object.reminder) return null;
    const url =
      object.reminder.url?.trim() || extractFirstUrl(input.userText) || null;
    const result = createReminderFromInput({
      sessionId: input.sessionId,
      sourceMessageId: input.messageId,
      reminder: {
        title: object.reminder.title,
        dueDate: object.reminder.dueDate,
        dueTime: object.reminder.dueTime ?? null,
        url,
        notes: object.reminder.notes ?? null,
        timezone,
      },
    });
    if (!result.ok) {
      console.error("[reminders] fallback extraction invalid", result.error);
      return null;
    }
    return result.reminder ?? null;
  } catch (error) {
    console.error("[reminders] fallback extraction failed", error);
    return null;
  }
}
