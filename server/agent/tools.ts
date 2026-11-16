import { tool, type LanguageModel } from "ai";
import { z } from "zod";
import { recallMemories } from "../memory";
import { webSearch } from "../search";
import { extractPage } from "../search/extract";
import {
  createReminderFromInput,
  updateReminderFromInput,
} from "../reminders/service";
import { extractFirstUrl } from "../reminders/schedule";

const freshnessSchema = z
  .enum(["any", "day", "week", "month", "year"])
  .optional()
  .describe("Restrict results by recency. Use week/month for 'changed since'.");

export function createAgentTools(options: {
  model: LanguageModel;
  context?: string;
  userText?: string;
  sessionId?: string | null;
  userMessageId?: string | null;
}) {
  return {
    web_search: tool({
      description:
        "Search the live web. Returns fresh results with numbered source ids, titles, URLs, dates, snippets, and extracted page text. Use for anything current, for pricing/changelog checks, and to verify whether an earlier answer is still true.",
      inputSchema: z.object({
        query: z
          .string()
          .min(2)
          .describe(
            "Natural-language information need. Include entity names and dates. The tool expands it into several searches.",
          ),
        freshness: freshnessSchema,
        maxResults: z.number().int().min(1).max(10).optional(),
      }),
      execute: async ({ query, freshness, maxResults }, { abortSignal }) => {
        const response = await webSearch({
          query,
          freshness,
          maxResults,
          context: options.context,
          model: options.model,
          signal: abortSignal,
        });
        if (response.results.length === 0) {
          return {
            queries: response.queries,
            provider: response.provider,
            sources: [],
            errors: response.errors,
            note: "No results. Try a shorter or differently-worded query.",
          };
        }
        let budget = 9000;
        const sources = response.results.map((result) => {
          const content = (result.content ?? "").slice(0, Math.min(2600, budget));
          budget -= content.length;
          return {
            id: result.sourceId,
            title: result.title,
            url: result.url,
            publishedAt: result.publishedAt ?? null,
            snippet: result.snippet.slice(0, 400),
            content,
          };
        });
        return {
          queries: response.queries,
          provider: response.provider,
          cached: response.cached,
          sources,
          errors: response.errors,
        };
      },
    }),

    fetch_url: tool({
      description:
        "Fetch and read a specific web page as clean text. Use when a search snippet is incomplete or when the user gives a URL.",
      inputSchema: z.object({
        url: z.string().url(),
      }),
      execute: async ({ url }, { abortSignal }) => {
        const page = await extractPage(url, { signal: abortSignal });
        return {
          title: page.title,
          url: page.url,
          publishedAt: page.publishedAt ?? null,
          text: page.text.slice(0, 9000),
          error: page.error ?? null,
        };
      },
    }),

    create_reminder: tool({
      description:
        "Create a future reminder. If the user names a clock time, set dueTime and they are notified once at that local date and time. If they name only a date, omit dueTime and they are nudged all day (every 2 hours from 09:00 to 21:00). Include a URL when the user mentions one.",
      inputSchema: z.object({
        title: z
          .string()
          .min(2)
          .max(160)
          .describe("Short action title, e.g. 'Email HR at Acme about the interview'."),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .describe("Local date in YYYY-MM-DD format."),
        dueTime: z
          .string()
          .optional()
          .nullable()
          .describe(
            "Clock time when the user named one, such as 15:30 or 3:30 pm. Omit when only a date was given so the reminder runs all day.",
          ),
        url: z
          .string()
          .optional()
          .nullable()
          .describe("Optional website URL the user mentioned."),
        notes: z.string().optional().nullable(),
      }),
      execute: async ({ title, dueDate, dueTime, url, notes }) => {
        const result = await createReminderFromInput({
          sessionId: options.sessionId,
          sourceMessageId: options.userMessageId,
          reminder: {
            title,
            dueDate,
            dueTime: dueTime ?? null,
            url: url || extractFirstUrl(options.userText ?? ""),
            notes: notes ?? null,
          },
        });
        if (!result.ok || !result.reminder) {
          return { ok: false, error: result.error ?? "Could not create reminder." };
        }
        return {
          ok: true,
          duplicate: Boolean(result.duplicate),
          reminder: {
            id: result.reminder.id,
            title: result.reminder.title,
            dueDate: result.reminder.dueDate,
            dueTime: result.reminder.dueTime,
            url: result.reminder.url,
            nextNudgeAt: result.reminder.nextNudgeAt,
          },
          note: result.duplicate
            ? "An identical active reminder already exists."
            : result.reminder.dueTime
              ? `One notification at ${result.reminder.dueDate} ${result.reminder.dueTime}.`
              : `All-day reminder on ${result.reminder.dueDate}. Nudges every 2 hours from 09:00 to 21:00.`,
        };
      },
    }),

    update_reminder: tool({
      description:
        "Edit an existing reminder from the active reminder list. Use its id. Change only the fields the user asked to change. Set dueTime to an empty string to make it all day. Set status to done when they completed or cancelled it. The matching long-term memory is updated or removed.",
      inputSchema: z.object({
        id: z
          .string()
          .min(1)
          .describe("Reminder id from the active reminder list. A unique title also works."),
        title: z.string().min(2).max(160).optional(),
        dueDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("New local date, YYYY-MM-DD."),
        dueTime: z
          .string()
          .nullable()
          .optional()
          .describe(
            "New clock time, such as 16:00 or 4 pm. Empty string makes it all day. Omit to keep the current time.",
          ),
        notes: z.string().nullable().optional(),
        url: z.string().nullable().optional(),
        status: z.enum(["active", "done"]).optional(),
      }),
      execute: async ({ id, title, dueDate, dueTime, notes, url, status }) => {
        const result = await updateReminderFromInput({
          id,
          patch: { title, dueDate, dueTime, notes, url, status },
        });
        if (!result.ok || !result.reminder) {
          return { ok: false, error: result.error ?? "Could not update reminder." };
        }
        const reminder = result.reminder;
        return {
          ok: true,
          updated: true,
          reminder: {
            id: reminder.id,
            title: reminder.title,
            dueDate: reminder.dueDate,
            dueTime: reminder.dueTime,
            url: reminder.url,
            status: reminder.status,
            nextNudgeAt: reminder.nextNudgeAt,
          },
          note:
            reminder.status === "done"
              ? "Marked done. Notifications stopped and the memory was cleared."
              : reminder.dueTime
                ? `Updated. One notification at ${reminder.dueDate} ${reminder.dueTime}.`
                : `Updated. All-day reminder on ${reminder.dueDate}.`,
        };
      },
    }),

    recall_memory: tool({
      description:
        "Search the user's past conversations and durable memories. Use for references to earlier chats, decisions, lists, preferences, or dates. Pass explicit ISO dates (YYYY-MM-DD) for 'on 3 November' or 'last Tuesday'.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("What to remember. Use an empty string for a pure date lookup."),
        from: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("Start date, inclusive, YYYY-MM-DD"),
        to: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional()
          .describe("End date, inclusive, YYYY-MM-DD"),
      }),
      execute: async ({ query, from, to }) => {
        const hits = await recallMemories({ query, from, to, limit: 14 });
        return {
          from: from ?? null,
          to: to ?? null,
          hits: hits.map((hit) => ({
            date: hit.eventDate,
            kind: hit.kind,
            text: hit.text.slice(0, 900),
            session: hit.sessionTitle,
          })),
          note:
            hits.length === 0
              ? "Nothing found in stored conversations for that query/range."
              : undefined,
        };
      },
    }),
  };
}

export type AgentTools = ReturnType<typeof createAgentTools>;
