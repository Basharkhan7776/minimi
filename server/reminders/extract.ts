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
        .describe(
          "Clock time as HH:MM when the user named one. Null when only a date was given, so the reminder runs all day.",
        ),
      url: z
        .string()
        .nullable()
        .optional()
        .describe("A website URL mentioned by the user, or null."),
      notes: z.string().nullable().optional(),
    })
    .nullable(),
});

const EXPLICIT_REMINDER =
  /\b(remind me|remember to|don'?t forget|don’t forget|set a reminder)\b/i;

const COMMITMENT = /\b(i (?:will|need to|have to)|follow up|schedule)\b/i;

const WHEN =
  /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|\d{1,2}(?::\d{2})?\s*(?:am|pm)|at \d{1,2})\b/i;

export function shouldExtractReminder(userText: string): boolean {
  if (EXPLICIT_REMINDER.test(userText)) return true;
  return COMMITMENT.test(userText) && WHEN.test(userText);
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
        "You extract a single future reminder from a user message. Only create a reminder when the user explicitly commits to doing something later or asks to be reminded. Resolve relative dates using the supplied current local date and time. Use YYYY-MM-DD. If the user names a clock time, set dueTime to 24-hour HH:MM so it fires once then. If they name only a date, set dueTime to null so it reminds all day. If no clear future commitment exists, return reminder: null. Never invent a date or a time.",
      prompt: `Current local date: ${localDateString(now)}\nCurrent local time: ${now.toLocaleTimeString("en-GB", { hour12: false })}\nTimezone: ${timezone}\n\nUser message:\n${input.userText.slice(0, 4000)}\n\nExtract the reminder. If a URL appears in the message, include it.`,
    });

    if (!object.reminder) return null;
    const url =
      object.reminder.url?.trim() || extractFirstUrl(input.userText) || null;
    const result = await createReminderFromInput({
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
