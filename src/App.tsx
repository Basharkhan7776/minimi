"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";
import { Toaster, toast } from "sonner";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { AppSidebar } from "@/components/app-sidebar";
import { ChatPage } from "@/components/chat/chat-page";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { api } from "@/lib/api";
import type {
  BootstrapData,
  ChatUIMessage,
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
  const loadSeq = useRef(0);
  const themeSynced = useRef(false);

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
  }, [loadBootstrap, refreshSessions]);

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
    const [, list] = await Promise.all([loadBootstrap(), refreshSessions(search)]);
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

  function openSettings(tab = "providers") {
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
          <Loader2Icon className="size-4 animate-spin" />
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
          onOpenSettings={() => openSettings("providers")}
          onTogglePin={(session) => void togglePin(session)}
          onRename={(session, title) => void renameSession(session, title)}
          onDelete={(session) => setPendingDelete(session)}
        />
        <SidebarInset className="h-svh overflow-hidden">
          {loadingSession ? (
            <div className="flex h-full items-center justify-center">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2Icon className="size-4 animate-spin" />
                Opening conversation…
              </div>
            </div>
          ) : (
            <ChatPage
              key={chatKey}
              bootstrap={bootstrap}
              session={activeSession}
              initialMessages={initialMessages}
              onSessionCreated={handleSessionCreated}
              onSessionsChanged={() => void refreshSessions(search)}
              onOpenSettings={() => openSettings("providers")}
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

      <Toaster position="top-center" />
    </>
  );
}
