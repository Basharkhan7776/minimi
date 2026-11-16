import fs from "node:fs";
import path from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { generateText, type UIMessage } from "ai";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { HOST, PORT, DATA_DIR } from "./config";
import { prepareAgentRun } from "./agent/run";
import { maybeGenerateTitle } from "./agent/title";
import { resolveProviderModel } from "./agent/providers";
import {
  closeDb,
  getAllSettings,
  getDb,
  getSetting,
  setSetting,
} from "./db";
import { getFilesByIds } from "./db/files";
import { extractText, getUiMessages, upsertMessage } from "./db/messages";
import {
  createProvider,
  deleteProvider,
  getFirstUsableProvider,
  getProvider,
  listProviders,
  updateProvider,
} from "./db/providers";
import {
  createSession,
  deleteSession,
  getSession,
  listAllSessionsForExport,
  listSessions,
  updateSession,
} from "./db/sessions";
import { getAllMessagesForExport } from "./db/messages";
import { listMemories } from "./db/memories";
import type { ProviderConfig, Session } from "./db/types";
import {
  getEmbeddingStatus,
  warmEmbeddings,
} from "./embeddings";
import { saveUploadedFile, removeStoredFile } from "./file-store";
import {
  claimPendingNotifications,
  countReminders,
  createReminder,
  deleteReminder,
  getReminder,
  hasReminderForMessage,
  listAllEventsForExport,
  listAllRemindersForExport,
  listEventsForReminder,
  listReminders,
  syncReminderEvents,
  updateReminder,
} from "./db/reminders";
import {
  REMINDER_CLAIM_WINDOW_MS,
  startReminderScheduler,
} from "./reminders/engine";
import { extractReminderForTurn } from "./reminders/extract";
import { createReminderFromInput } from "./reminders/service";
import { validateReminderInput } from "./reminders/schedule";
import {
  extractMemoriesForTurn,
  memoryStats,
  rebuildMemories,
  saveMemories,
  syncReminderMemory,
} from "./memory";
import { deleteFileRecord } from "./db/files";

const app = new Hono();

const ALLOWED_ORIGINS = new Set([
  "http://localhost:1420",
  "http://127.0.0.1:1420",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
  ...(process.env.MINIMI_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

app.use(
  "/api/*",
  cors({
    origin: (origin) =>
      !origin || ALLOWED_ORIGINS.has(origin) ? origin || "*" : null,
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

app.get("/api/health", (c) =>
  c.json({ ok: true, name: "minimi", dataDir: DATA_DIR, time: Date.now() }),
);

app.get("/api/bootstrap", (c) => {
  const providers = listProviders().map(publicProvider);
  const defaultProvider =
    providers.find((provider) => provider.enabled && provider.hasApiKey) ??
    providers.find((provider) => provider.type === "ollama") ??
    providers[0] ??
    null;
  return c.json({
    providers,
    defaultProviderId: defaultProvider?.id ?? null,
    defaultModel: defaultProvider?.defaultModel ?? null,
    settings: getAllSettings(),
    embedding: getEmbeddingStatus(),
    memory: memoryStats(),
    reminders: { active: countReminders() },
  });
});

function publicProvider(provider: ProviderConfig) {
  return {
    id: provider.id,
    type: provider.type,
    name: provider.name,
    baseUrl: provider.baseUrl,
    defaultModel: provider.defaultModel,
    enabled: provider.enabled,
    sortOrder: provider.sortOrder,
    hasApiKey: Boolean(provider.apiKey),
    apiKeyPreview: provider.apiKey
      ? `••••••${provider.apiKey.slice(-4)}`
      : null,
  };
}

/* ----------------------------- sessions ----------------------------- */

app.get("/api/sessions", (c) => {
  const query = c.req.query("q") ?? undefined;
  const pinnedParam = c.req.query("pinned");
  return c.json({
    sessions: listSessions({
      query,
      pinned:
        pinnedParam === "true" ? true : pinnedParam === "false" ? false : undefined,
    }),
  });
});

app.post("/api/sessions", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string;
    providerId?: string;
    model?: string;
  };
  const fallback = getFirstUsableProvider();
  const session = createSession({
    title: body.title,
    providerId: body.providerId ?? fallback?.id ?? null,
    model: body.model ?? fallback?.defaultModel ?? null,
  });
  return c.json({ session }, 201);
});

app.get("/api/sessions/:id", (c) => {
  const session = getSession(c.req.param("id"));
  if (!session) return c.json({ error: "Session not found" }, 404);
  return c.json({ session, messages: getUiMessages(session.id) });
});

app.patch("/api/sessions/:id", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string;
    pinned?: boolean;
    archived?: boolean;
    providerId?: string | null;
    model?: string | null;
  };
  const session = updateSession(c.req.param("id"), body);
  if (!session) return c.json({ error: "Session not found" }, 404);
  return c.json({ session });
});

app.delete("/api/sessions/:id", (c) => {
  deleteSession(c.req.param("id"));
  return c.json({ ok: true });
});

/* ------------------------------- chat ------------------------------- */

interface ChatBody {
  sessionId?: string;
  messages: UIMessage[];
  attachmentIds?: string[];
  providerId?: string;
  model?: string;
}

app.post("/api/chat", async (c) => {
  let body: ChatBody;
  try {
    body = await c.req.json<ChatBody>();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!Array.isArray(body.messages)) {
    return c.json({ error: "messages must be an array" }, 400);
  }

  let session: Session | null = null;
  if (body.sessionId) session = getSession(body.sessionId);
  if (!session) {
    const fallback = getFirstUsableProvider();
    session = createSession({
      providerId: body.providerId ?? fallback?.id ?? null,
      model: body.model ?? fallback?.defaultModel ?? null,
    });
  }
  if (body.providerId !== undefined || body.model !== undefined) {
    session =
      updateSession(session.id, {
        providerId: body.providerId ?? session.providerId,
        model: body.model ?? session.model,
      }) ?? session;
  }

  for (const message of body.messages) {
    try {
      upsertMessage(session.id, message);
    } catch (error) {
      console.error("[chat] failed to persist incoming message", error);
    }
  }

  let run;
  try {
    run = await prepareAgentRun({
      session,
      messages: body.messages,
      attachmentIds: body.attachmentIds,
      abortSignal: c.req.raw.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return c.json({ error: message }, 400);
  }

  const resolved = run.resolved;
  const sessionId = session.id;
  const userText = run.userText;
  const assistantId = run.assistantId;

  return run.result.toUIMessageStreamResponse({
    originalMessages: body.messages,
    generateMessageId: () => assistantId,
    sendSources: true,
    sendReasoning: true,
    onError: (error) => {
      console.error("[chat] stream error", error);
      return error instanceof Error ? error.message : "The model request failed.";
    },
    onEnd: ({ responseMessage, isAborted }) => {
      try {
        upsertMessage(sessionId, responseMessage, { model: resolved.modelId });
      } catch (error) {
        console.error("[chat] failed to persist assistant message", error);
      }
      const assistantText = extractText(responseMessage.parts);
      if (!isAborted && assistantText) {
        void (async () => {
          const titlePromise = maybeGenerateTitle({
            model: resolved.model,
            sessionId,
            userText,
            assistantText,
          }).catch((error) => {
            console.error("[chat] title generation failed", error);
          });
          try {
            await extractMemoriesForTurn({
              model: resolved.model,
              sessionId,
              messageId: assistantId,
              userText,
              assistantText,
            });
          } catch (error) {
            console.error("[chat] memory extraction failed", error);
          }
          if (run.userMessageId && !hasReminderForMessage(run.userMessageId)) {
            try {
              await extractReminderForTurn({
                model: resolved.model,
                sessionId,
                messageId: run.userMessageId,
                userText,
              });
            } catch (error) {
              console.error("[chat] reminder extraction failed", error);
            }
          }
          await titlePromise;
        })();
      }
    },
  });
});

/* ------------------------------ files ------------------------------- */

app.post("/api/files", async (c) => {
  const form = await c.req.formData().catch(() => null);
  if (!form) return c.json({ error: "Expected multipart form data" }, 400);
  const file = form.get("file");
  if (!(file instanceof File)) {
    return c.json({ error: "Missing file field" }, 400);
  }
  const sessionId = form.get("sessionId");
  try {
    const record = await saveUploadedFile({
      file,
      sessionId: typeof sessionId === "string" && sessionId ? sessionId : null,
    });
    return c.json({
      file: {
        id: record.id,
        name: record.name,
        mime: record.mime,
        size: record.size,
        hasText: Boolean(record.extractedText),
      },
    });
  } catch (error) {
    return c.json(
      { error: error instanceof Error ? error.message : String(error) },
      400,
    );
  }
});

app.get("/api/files/:id", (c) => {
  const id = c.req.param("id");
  const row = getDb()
    .prepare("SELECT * FROM files WHERE id = ?")
    .get(id) as
    | { path: string; mime: string; name: string }
    | undefined;
  if (!row || !fs.existsSync(row.path)) {
    return c.json({ error: "File not found" }, 404);
  }
  const data = fs.readFileSync(row.path);
  return c.body(data, 200, {
    "content-type": row.mime || "application/octet-stream",
    "content-disposition": `inline; filename="${row.name.replace(/"/g, "")}"`,
    "cache-control": "private, max-age=3600",
  });
});

app.delete("/api/files/:id", (c) => {
  const id = c.req.param("id");
  const db = getDb();
  const row = db
    .prepare("SELECT path FROM files WHERE id = ?")
    .get(id) as { path: string } | undefined;
  if (row?.path) removeStoredFile(row.path);
  deleteFileRecord(id);
  return c.json({ ok: true });
});

/* ---------------------------- reminders ----------------------------- */

app.get("/api/reminders", (c) => {
  const statusParam = c.req.query("status");
  const status =
    statusParam === "done" ? "done" : statusParam === "all" ? undefined : "active";
  const reminders = listReminders({
    status,
    sessionId: c.req.query("sessionId") || undefined,
    limit: 200,
  });
  return c.json({
    reminders: reminders.map((reminder) => ({
      ...reminder,
      events: listEventsForReminder(reminder.id).slice(-3),
    })),
    activeCount: countReminders(),
  });
});

app.post("/api/reminders", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string;
    dueDate?: string;
    dueTime?: string | null;
    notes?: string | null;
    url?: string | null;
    sessionId?: string | null;
    timezone?: string | null;
  };
  if (!body.title || !body.dueDate) {
    return c.json({ error: "title and dueDate are required" }, 400);
  }
  const result = await createReminderFromInput({
    sessionId: body.sessionId ?? null,
    reminder: {
      title: body.title,
      dueDate: body.dueDate,
      dueTime: body.dueTime ?? null,
      notes: body.notes ?? null,
      url: body.url ?? null,
      timezone: body.timezone ?? null,
    },
  });
  if (!result.ok || !result.reminder) {
    return c.json({ error: result.error ?? "Could not create reminder" }, 400);
  }
  return c.json(
    { reminder: result.reminder, duplicate: Boolean(result.duplicate) },
    201,
  );
});

app.patch("/api/reminders/:id", async (c) => {
  const id = c.req.param("id");
  const existing = getReminder(id);
  if (!existing) return c.json({ error: "Reminder not found" }, 404);

  const body = (await c.req.json().catch(() => ({}))) as {
    title?: string;
    dueDate?: string;
    dueTime?: string | null;
    notes?: string | null;
    url?: string | null;
    timezone?: string | null;
    status?: "active" | "done";
  };

  if (
    body.title !== undefined ||
    body.dueDate !== undefined ||
    body.dueTime !== undefined
  ) {
    const validated = validateReminderInput(
      {
        title: body.title ?? existing.title,
        dueDate: body.dueDate ?? existing.dueDate,
        dueTime: body.dueTime !== undefined ? body.dueTime : existing.dueTime,
        notes: body.notes !== undefined ? body.notes : existing.notes,
        url: body.url !== undefined ? body.url : existing.url,
        timezone: body.timezone ?? existing.timezone,
      },
      { allowPast: existing.status === "done" },
    );
    if (!validated.ok) return c.json({ error: validated.error }, 400);
    body.title = validated.input.title;
    body.dueDate = validated.input.dueDate;
    body.dueTime = validated.input.dueTime ?? null;
    body.notes = validated.input.notes ?? null;
    body.url = validated.input.url ?? null;
    body.timezone = validated.input.timezone ?? null;
  }

  const reminder = updateReminder(id, {
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.dueDate !== undefined ? { dueDate: body.dueDate } : {}),
    ...(body.dueTime !== undefined ? { dueTime: body.dueTime } : {}),
    ...(body.notes !== undefined ? { notes: body.notes } : {}),
    ...(body.url !== undefined ? { url: body.url } : {}),
    ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
    ...(body.status !== undefined ? { status: body.status } : {}),
  });
  if (reminder) await syncReminderMemory(reminder, existing);
  return c.json({ reminder });
});

app.delete("/api/reminders/:id", async (c) => {
  const existing = getReminder(c.req.param("id"));
  if (existing) await syncReminderMemory({ ...existing, status: "done" }, existing);
  deleteReminder(c.req.param("id"));
  return c.json({ ok: true });
});

app.get("/api/reminder-events/pending", (c) =>
  c.json({
    events: claimPendingNotifications(
      Date.now(),
      20,
      REMINDER_CLAIM_WINDOW_MS,
    ),
  }),
);

/* ---------------------------- providers ----------------------------- */

app.get("/api/providers", (c) =>
  c.json({ providers: listProviders().map(publicProvider) }),
);

app.patch("/api/providers/:id", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    name?: string;
    baseUrl?: string | null;
    apiKey?: string;
    defaultModel?: string | null;
    enabled?: boolean;
    sortOrder?: number;
  };
  const patch: Parameters<typeof updateProvider>[1] = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.baseUrl !== undefined) patch.baseUrl = body.baseUrl || null;
  if (body.defaultModel !== undefined)
    patch.defaultModel = body.defaultModel || null;
  if (body.enabled !== undefined) patch.enabled = body.enabled;
  if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;
  if (body.apiKey !== undefined)
    patch.apiKey = body.apiKey.trim() === "" ? null : body.apiKey.trim();

  const provider = updateProvider(c.req.param("id"), patch);
  if (!provider) return c.json({ error: "Provider not found" }, 404);
  return c.json({ provider: publicProvider(provider) });
});

app.post("/api/providers", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    id?: string;
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    defaultModel?: string;
  };
  if (!body.name || !body.baseUrl || !body.defaultModel) {
    return c.json(
      { error: "name, baseUrl, and defaultModel are required" },
      400,
    );
  }
  const id =
    (body.id || body.name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || `custom-${Date.now()}`;
  if (getProvider(id)) return c.json({ error: "Provider id already exists" }, 409);
  const provider = createProvider({
    id,
    type: "custom",
    name: body.name,
    baseUrl: body.baseUrl,
    apiKey: body.apiKey ?? null,
    defaultModel: body.defaultModel,
  });
  return c.json({ provider: publicProvider(provider) }, 201);
});

app.delete("/api/providers/:id", (c) => {
  deleteProvider(c.req.param("id"));
  return c.json({ ok: true });
});

app.post("/api/providers/:id/test", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { model?: string };
  const started = Date.now();
  try {
    const resolved = resolveProviderModel(c.req.param("id"), body.model);
    const { text } = await generateText({
      model: resolved.model,
      prompt: "Reply with exactly: OK",
      maxOutputTokens: 512,
      temperature: 0,
      abortSignal: AbortSignal.timeout(25000),
    });
    return c.json({
      ok: true,
      ms: Date.now() - started,
      model: resolved.modelId,
      reply: text.trim().slice(0, 80),
    });
  } catch (error) {
    return c.json(
      {
        ok: false,
        ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      },
      400,
    );
  }
});

/* ---------------------------- settings ------------------------------ */

const EDITABLE_SETTINGS = new Set([
  "search.provider",
  "search.maxResults",
  "search.cacheTtlMinutes",
  "memory.enabled",
  "memory.autoExtract",
  "chat.maxSteps",
  "chat.autoTitle",
  "notifications.enabled",
  "app.theme",
  "app.language",
  "user.name",
  "user.email",
  "user.xHandle",
  "user.birthYear",
  "user.plan",
]);

app.get("/api/settings", (c) => c.json({ settings: getAllSettings() }));

app.patch("/api/settings", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  for (const [key, value] of Object.entries(body)) {
    if (!EDITABLE_SETTINGS.has(key)) continue;
    setSetting(key, String(value));
  }
  return c.json({ settings: getAllSettings() });
});

/* ----------------------------- memory ------------------------------- */

app.get("/api/memory", (c) =>
  c.json({
    stats: memoryStats(),
    embedding: getEmbeddingStatus(),
    memories: listMemories(40),
  }),
);

app.delete("/api/memory", (c) => {
  const db = getDb();
  db.prepare("DELETE FROM vec_memories").run();
  db.prepare("DELETE FROM memories").run();
  return c.json({ ok: true, stats: memoryStats() });
});

app.post("/api/memory/rebuild", async (c) => {
  const count = await rebuildMemories();
  return c.json({ ok: true, count, stats: memoryStats() });
});

/* ---------------------------- data import --------------------------- */

app.get("/api/export", (c) => {
  const sessions = listAllSessionsForExport();
  const messages = getAllMessagesForExport();
  const memories = listMemories(100000);
  const settings = getAllSettings();
  const reminders = listAllRemindersForExport();
  const reminderEvents = listAllEventsForExport();
  return c.json(
    {
      format: "minimi-export",
      version: 2,
      exportedAt: new Date().toISOString(),
      sessions,
      messages,
      memories,
      reminders,
      reminderEvents,
      settings,
    },
    200,
    {
      "content-disposition": `attachment; filename="minimi-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  );
});

app.post("/api/import", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | {
        format?: string;
        sessions?: Array<Record<string, unknown>>;
        messages?: Array<Record<string, unknown>>;
        settings?: Record<string, string>;
        memories?: Array<Record<string, unknown>>;
        reminders?: Array<Record<string, unknown>>;
        reminderEvents?: Array<Record<string, unknown>>;
      }
    | null;
  if (!body || body.format !== "minimi-export") {
    return c.json({ error: "Not a Minimi export file" }, 400);
  }
  const db = getDb();
  let importedSessions = 0;
  let importedMessages = 0;
  let importedMemories = 0;
  let importedReminders = 0;

  const transaction = db.transaction(() => {
    for (const session of body.sessions ?? []) {
      const id = String(session.id ?? "");
      if (!id) continue;
      db.prepare(
        `INSERT OR REPLACE INTO sessions
          (id, title, title_locked, title_turn, pinned, archived, provider_id, model, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        String(session.title ?? "Imported chat"),
        session.titleLocked ? 1 : 0,
        Number(session.titleTurn ?? 0),
        session.pinned ? 1 : 0,
        session.archived ? 1 : 0,
        (session.providerId as string | null) ?? null,
        (session.model as string | null) ?? null,
        Number(session.createdAt ?? Date.now()),
        Number(session.updatedAt ?? Date.now()),
      );
      importedSessions += 1;
    }

    for (const message of body.messages ?? []) {
      const id = String(message.id ?? "");
      const sessionId = String(message.sessionId ?? "");
      if (!id || !sessionId) continue;
      const parts = Array.isArray(message.parts) ? message.parts : [];
      const content = String(message.content ?? "");
      db.prepare(
        `INSERT OR REPLACE INTO messages
          (id, session_id, role, content, parts_json, metadata_json, created_at, model, usage_json, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        sessionId,
        String(message.role ?? "user"),
        content,
        JSON.stringify(parts),
        message.metadata ? JSON.stringify(message.metadata) : null,
        Number(message.createdAt ?? Date.now()),
        (message.model as string | null) ?? null,
        message.usage ? JSON.stringify(message.usage) : null,
        (message.error as string | null) ?? null,
      );
      if (content) {
        db.prepare("DELETE FROM messages_fts WHERE message_id = ?").run(id);
        db.prepare(
          "INSERT INTO messages_fts (content, message_id, session_id, role, created_at) VALUES (?, ?, ?, ?, ?)",
        ).run(
          content,
          id,
          sessionId,
          String(message.role ?? "user"),
          Number(message.createdAt ?? Date.now()),
        );
      }
      importedMessages += 1;
    }

    for (const [key, value] of Object.entries(body.settings ?? {})) {
      if (!EDITABLE_SETTINGS.has(key)) continue;
      setSetting(key, String(value));
    }

    for (const reminder of body.reminders ?? []) {
      const id = String(reminder.id ?? "");
      if (!id) continue;
      db.prepare(
        `INSERT OR REPLACE INTO reminders
          (id, session_id, title, notes, url, due_date, due_time, timezone,
           status, source_message_id, created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        (reminder.sessionId as string | null) ?? null,
        String(reminder.title ?? "Imported reminder"),
        (reminder.notes as string | null) ?? null,
        (reminder.url as string | null) ?? null,
        String(reminder.dueDate ?? ""),
        (reminder.dueTime as string | null) ?? null,
        (reminder.timezone as string | null) ?? null,
        reminder.status === "done" ? "done" : "active",
        (reminder.sourceMessageId as string | null) ?? null,
        Number(reminder.createdAt ?? Date.now()),
        Number(reminder.updatedAt ?? Date.now()),
        reminder.completedAt ? Number(reminder.completedAt) : null,
      );
      importedReminders += 1;
    }

    for (const event of body.reminderEvents ?? []) {
      const id = String(event.id ?? "");
      const reminderId = String(event.reminderId ?? "");
      if (!id || !reminderId) continue;
      db.prepare(
        `INSERT OR REPLACE INTO reminder_events
          (id, reminder_id, kind, scheduled_for, status, fired_at, notified_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        reminderId,
        String(event.kind ?? "day_hour"),
        Number(event.scheduledFor ?? Date.now()),
        String(event.status ?? "pending"),
        event.firedAt ? Number(event.firedAt) : null,
        event.notifiedAt ? Number(event.notifiedAt) : null,
        Number(event.createdAt ?? Date.now()),
      );
    }
  });
  transaction();

  for (const reminder of body.reminders ?? []) {
    if (reminder.status !== "done" && reminder.id) {
      syncReminderEvents(String(reminder.id));
    }
  }

  const existingMemory = db.prepare(
    "SELECT 1 FROM memories WHERE session_id = ? AND text = ? LIMIT 1",
  );
  const memoryBatch: Array<{
    text: string;
    kind?: string;
    eventDate?: string | null;
    sessionId: string;
  }> = [];
  for (const memory of body.memories ?? []) {
    const text = String(memory.text ?? "").trim();
    const sessionId = String(memory.sessionId ?? "");
    if (!text || !sessionId) continue;
    if (existingMemory.get(sessionId, text)) continue;
    memoryBatch.push({
      text,
      kind: memory.kind ? String(memory.kind) : "fact",
      eventDate: memory.eventDate ? String(memory.eventDate) : null,
      sessionId,
    });
  }
  importedMemories = await saveMemories(memoryBatch);

  return c.json({
    ok: true,
    importedSessions,
    importedMessages,
    importedMemories,
    importedReminders,
  });
});

app.post("/api/data/clear", (c) => {
  const db = getDb();
  const files = db.prepare("SELECT path FROM files").all() as Array<{
    path: string;
  }>;
  for (const file of files) removeStoredFile(file.path);
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM reminder_events").run();
    db.prepare("DELETE FROM reminders").run();
    db.prepare("DELETE FROM vec_memories").run();
    db.prepare("DELETE FROM memories").run();
    db.prepare("DELETE FROM messages_fts").run();
    db.prepare("DELETE FROM messages").run();
    db.prepare("DELETE FROM files").run();
    db.prepare("DELETE FROM sessions").run();
    db.prepare("DELETE FROM search_cache").run();
  });
  transaction();
  return c.json({ ok: true });
});

/* --------------------------- static build --------------------------- */

const distDir = path.resolve("dist");
if (fs.existsSync(distDir)) {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}

const stopReminderScheduler = startReminderScheduler();

const server = serve(
  {
    fetch: app.fetch,
    hostname: HOST,
    port: PORT,
  },
  (info) => {
    console.log(`\n  Minimi server ready at http://${HOST}:${info.port}`);
    console.log(`  Data: ${DATA_DIR}\n`);
  },
);

void warmEmbeddings();

function shutdown(): void {
  stopReminderScheduler();
  server.close();
  closeDb();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
