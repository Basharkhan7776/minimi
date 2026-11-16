"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";
import { Toaster, toast } from "sonner";
import { RefreshCwIcon } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "@/components/app-sidebar";
import { ChatPage } from "@/components/chat/chat-page";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ReminderDialog } from "@/components/reminders/reminder-dialog";
import { api } from "@/lib/api";
import { showSystemNotification } from "@/lib/notifications";
import { formatReminderDue, nudgeBody } from "@/lib/reminders";
import type {
  BootstrapData,
  ChatUIMessage,
  Reminder,
  Session,
} from "@/lib/types";

export default function App() {
  const { setTheme } = useTheme();
  const [bootstrap, setBootstrap] = useState<BootstrapData | null>(null);
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [search, setSearch] = useState("");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [initialMessages, setInitialMessages] = useState<ChatUIMessage[]>([]);
  const [chatKey, setChatKey] = useState(0);
  const [loadingSession, setLoadingSession] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("providers");
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [reminderDialogOpen, setReminderDialogOpen] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const remindersRef = useRef<Reminder[]>([]);
  const openSessionRef = useRef<(id: string) => void>(() => undefined);
  const loadSeq = useRef(0);
  const themeSynced = useRef(false);

  remindersRef.current = reminders;
  openSessionRef.current = (id) => {
    void selectSession(id);
  };

  const refreshSessions = useCallback(async (query = "") => {
    try {
      const result = await api.listSessions(query);
      setSessions(result.sessions);
      setActiveSession((current) =>
        current
          ? (result.sessions.find((session) => session.id === current.id) ??
            current)
          : current,
      );
      return result.sessions;
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load conversations.",
      );
      return [];
    }
  }, []);

  const refreshReminders = useCallback(async () => {
    try {
      const result = await api.listReminders("all");
      setReminders(result.reminders);
      return result.reminders;
    } catch (error) {
      console.error("[reminders] could not load", error);
      return [];
    }
  }, []);

  const loadBootstrap = useCallback(async () => {
    try {
      const data = await api.bootstrap();
      setBootstrap(data);
      setBootstrapError(null);
    } catch (error) {
      setBootstrapError(
        error instanceof Error ? error.message : "Could not reach the server.",
      );
    }
  }, []);

  useEffect(() => {
    void loadBootstrap();
    void refreshSessions();
    void refreshReminders();
  }, [loadBootstrap, refreshSessions, refreshReminders]);

  useEffect(() => {
    const timer = setInterval(() => void refreshReminders(), 30_000);
    return () => clearInterval(timer);
  }, [refreshReminders]);

  useEffect(() => {
    if (!bootstrap) return;
    if (bootstrap.settings["notifications.enabled"] === "0") return;
    let cancelled = false;

    async function pollNotifications() {
      try {
        const { events } = await api.pendingReminderEvents();
        if (events.length === 0) return;
        for (const event of events) {
          const reminder = remindersRef.current.find(
            (item) => item.id === event.reminderId,
          );
          const title = event.reminderTitle ?? reminder?.title ?? "Reminder";
          const body = reminder
            ? `${formatReminderDue(reminder)} · ${nudgeBody(event)}`
            : nudgeBody(event);
          const open = () => {
            if (event.sessionId) openSessionRef.current(event.sessionId);
          };
          const shown = await showSystemNotification({
            title: `Minimi · ${title}`,
            body,
            tag: event.id,
            onClick: open,
          });
          if (!shown) {
            toast(title, {
              description: body,
              action: event.sessionId
                ? { label: "Open chat", onClick: open }
                : undefined,
            });
          }
        }
        if (!cancelled) void refreshReminders();
      } catch {
        // The next poll will retry; notifications must never break chat.
      }
    }

    void pollNotifications();
    const timer = setInterval(() => void pollNotifications(), 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [bootstrap, refreshReminders]);

  useEffect(() => {
    if (!bootstrap || themeSynced.current) return;
    themeSynced.current = true;
    const saved = bootstrap.settings["app.theme"];
    if (saved === "light" || saved === "dark" || saved === "system") {
      setTheme(saved);
    }
  }, [bootstrap, setTheme]);

  function newChat() {
    setActiveSessionId(null);
    setActiveSession(null);
    setInitialMessages([]);
    setChatKey((value) => value + 1);
  }

  async function selectSession(id: string) {
    if (id === activeSessionId) return;
    const seq = ++loadSeq.current;
    setLoadingSession(true);
    try {
      const detail = await api.getSession(id);
      if (seq !== loadSeq.current) return;
      setActiveSessionId(id);
      setActiveSession(detail.session);
      setInitialMessages(detail.messages);
      setChatKey((value) => value + 1);
    } catch (error) {
      if (seq === loadSeq.current) {
        toast.error(
          error instanceof Error ? error.message : "Could not open conversation.",
        );
      }
    } finally {
      if (seq === loadSeq.current) setLoadingSession(false);
    }
  }

  function handleSessionCreated(session: Session) {
    setActiveSessionId(session.id);
    setActiveSession(session);
    setSessions((current) => [
      session,
      ...current.filter((item) => item.id !== session.id),
    ]);
  }

  async function refreshAll() {
    const [, list] = await Promise.all([
      loadBootstrap(),
      refreshSessions(search),
      refreshReminders(),
    ]);
    if (activeSessionId && !list.some((session) => session.id === activeSessionId)) {
      newChat();
    }
  }

  async function togglePin(session: Session) {
    try {
      const result = await api.updateSession(session.id, {
        pinned: !session.pinned,
      });
      setSessions((current) =>
        current.map((item) =>
          item.id === result.session.id ? result.session : item,
        ),
      );
      if (activeSessionId === session.id) setActiveSession(result.session);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update.");
    }
  }

  async function renameSession(session: Session, title: string) {
    try {
      const result = await api.updateSession(session.id, { title });
      setSessions((current) =>
        current.map((item) =>
          item.id === result.session.id ? result.session : item,
        ),
      );
      if (activeSessionId === session.id) setActiveSession(result.session);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not rename.");
    }
  }

  async function deleteSession(session: Session) {
    try {
      await api.deleteSession(session.id);
      if (activeSessionId === session.id) newChat();
      await refreshSessions(search);
      toast.success("Conversation deleted.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete conversation.",
      );
    }
  }

  async function doneReminder(reminder: Reminder) {
    const nextStatus = reminder.status === "active" ? "done" : "active";
    try {
      await api.updateReminder(reminder.id, { status: nextStatus });
      setReminders((current) =>
        current.map((item) =>
          item.id === reminder.id ? { ...item, status: nextStatus } : item,
        ),
      );
      toast.success(
        nextStatus === "done"
          ? "Reminder completed. Nudges stopped."
          : "Reminder reopened.",
      );
      void refreshReminders();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update reminder.",
      );
    }
  }

  async function deleteReminder(reminder: Reminder) {
    try {
      await api.deleteReminder(reminder.id);
      setReminders((current) =>
        current.filter((item) => item.id !== reminder.id),
      );
      toast.success("Reminder deleted.");
      void refreshReminders();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete reminder.",
      );
    }
  }

  function addReminder() {
    setEditingReminder(null);
    setReminderDialogOpen(true);
  }

  function editReminder(reminder: Reminder) {
    setEditingReminder(reminder);
    setReminderDialogOpen(true);
  }

  function openReminderChat(sessionId: string) {
    void selectSession(sessionId);
  }

  function openSettings(tab = "appearance") {
    setSettingsTab(tab);
    setSettingsOpen(true);
  }

  if (bootstrapError && !bootstrap) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-6">
        <div className="max-w-sm text-center">
          <div className="mb-3 font-semibold text-lg">
            Minimi cannot reach its local server
          </div>
          <p className="mb-4 text-muted-foreground text-sm">
            {bootstrapError}
          </p>
          <Button onClick={() => void loadBootstrap()}>
            <RefreshCwIcon />
            Retry connection
          </Button>
          <p className="mt-4 text-muted-foreground text-xs">
            Run <code className="rounded bg-muted px-1 py-0.5">npm run dev</code>{" "}
            to start the server and web app together.
          </p>
        </div>
      </div>
    );
  }

  if (!bootstrap) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Spinner className="size-4" />
          Starting Minimi…
        </div>
      </div>
    );
  }

  return (
    <>
      <SidebarProvider>
        <AppSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          bootstrap={bootstrap}
          search={search}
          onSearch={(query) => {
            setSearch(query);
            void refreshSessions(query);
          }}
          onSelectSession={(id) => void selectSession(id)}
          onNewChat={newChat}
          onOpenSettings={() => openSettings("appearance")}
          onTogglePin={(session) => void togglePin(session)}
          onRename={(session, title) => void renameSession(session, title)}
          onDelete={(session) => setPendingDelete(session)}
        />
        <SidebarInset className="h-svh overflow-hidden">
          {loadingSession ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Spinner className="size-4" />
                Opening conversation…
              </div>
            </div>
          ) : (
            <ChatPage
              key={chatKey}
              bootstrap={bootstrap}
              session={activeSession}
              initialMessages={initialMessages}
              reminders={reminders}
              onSessionCreated={handleSessionCreated}
              onSessionsChanged={() => {
                void refreshSessions(search);
                void refreshReminders();
              }}
              onOpenSettings={() => openSettings("provider")}
              onOpenReminderChat={openReminderChat}
              onDoneReminder={(reminder) => void doneReminder(reminder)}
              onDeleteReminder={(reminder) => void deleteReminder(reminder)}
              onAddReminder={addReminder}
              onEditReminder={editReminder}
            />
          )}
        </SidebarInset>
      </SidebarProvider>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onChanged={() => void refreshAll()}
        initialTab={settingsTab}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(value) => {
          if (!value) setPendingDelete(null);
        }}
        title="Delete this conversation?"
        description={
          pendingDelete
            ? `"${pendingDelete.title}" and its messages will be removed. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (pendingDelete) void deleteSession(pendingDelete);
          setPendingDelete(null);
        }}
      />

      <ReminderDialog
        open={reminderDialogOpen}
        onOpenChange={setReminderDialogOpen}
        reminder={editingReminder}
        sessionId={activeSessionId}
        onSaved={() => void refreshReminders()}
      />

      <Toaster position="top-center" />
    </>
  );
}
