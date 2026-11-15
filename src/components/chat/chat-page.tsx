"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
  ArrowDownIcon,
  GlobeIcon,
  LightbulbIcon,
  PinIcon,
  RefreshCwIcon,
  Settings2Icon,
  SparklesIcon,
  PaperclipIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { API_BASE, api } from "@/lib/api";
import { greeting } from "@/lib/format";
import type {
  AttachmentMeta,
  BootstrapData,
  ChatUIMessage,
  Session,
} from "@/lib/types";
import { ModelPicker } from "@/components/model-picker";
import { ComposerBar } from "./composer-bar";
import { MessageItem } from "./message-item";

const SUGGESTIONS = [
  {
    icon: GlobeIcon,
    title: "Search the live web",
    prompt: "What happened in AI this week? Cite your sources.",
  },
  {
    icon: LightbulbIcon,
    title: "Think something through",
    prompt: "Help me plan a focused week around one important project.",
  },
  {
    icon: PaperclipIcon,
    title: "Read a document",
    prompt: "Summarise the attached document and list the action items.",
  },
  {
    icon: SparklesIcon,
    title: "Remember a preference",
    prompt: "Remember that I prefer concise answers with sources.",
  },
];

export function ChatPage({
  bootstrap,
  session,
  initialMessages,
  onSessionCreated,
  onSessionsChanged,
  onOpenSettings,
}: {
  bootstrap: BootstrapData;
  session: Session | null;
  initialMessages: ChatUIMessage[];
  onSessionCreated: (session: Session) => void;
  onSessionsChanged: () => void;
  onOpenSettings: () => void;
}) {
  const enabledProviders = bootstrap.providers.filter(
    (provider) => provider.enabled,
  );
  const fallbackProvider =
    bootstrap.providers.find(
      (provider) => provider.id === bootstrap.defaultProviderId && provider.enabled,
    ) ?? enabledProviders[0];

  const [providerId, setProviderId] = useState(
    session?.providerId ?? fallbackProvider?.id ?? "",
  );
  const [model, setModel] = useState(
    session?.model ?? fallbackProvider?.defaultModel ?? "",
  );
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [uploading, setUploading] = useState(false);
  const [atBottom, setAtBottom] = useState(true);

  const sessionIdRef = useRef<string | null>(session?.id ?? null);
  const chatIdRef = useRef(session?.id ?? `draft-${Date.now()}`);
  const providerRef = useRef(providerId);
  const modelRef = useRef(model);
  const attachmentIdsRef = useRef<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  providerRef.current = providerId;
  modelRef.current = model;

  const activeProvider = bootstrap.providers.find(
    (provider) => provider.id === providerId,
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: `${API_BASE}/api/chat`,
        body: () => ({
          sessionId: sessionIdRef.current,
          providerId: providerRef.current,
          model: modelRef.current,
          attachmentIds: attachmentIdsRef.current,
        }),
      }),
    [],
  );

  const {
    messages,
    sendMessage,
    status,
    stop,
    regenerate,
    error,
  } = useChat<ChatUIMessage>({
    id: chatIdRef.current,
    messages: initialMessages,
    transport,
    throttle: 40,
    onFinish: () => {
      onSessionsChanged();
      setTimeout(onSessionsChanged, 1600);
    },
    onError: (error) => {
      toast.error(error.message || "The model request failed.");
    },
  });

  const streaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    if (atBottom) {
      bottomRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages, status, atBottom]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, []);

  function onScroll() {
    const element = scrollRef.current;
    if (!element) return;
    const distance =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    setAtBottom(distance < 80);
  }

  async function handleFiles(files: FileList) {
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const { file: uploaded } = await api.uploadFile(
          file,
          sessionIdRef.current,
        );
        setAttachments((current) => [
          ...current,
          {
            id: uploaded.id,
            name: uploaded.name,
            mime: uploaded.mime,
            size: uploaded.size,
          },
        ]);
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not upload that file.",
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleSend(text: string) {
    const files = attachments;
    if (!text && files.length === 0) return;
    if (!providerId || !model) {
      toast.error("Add a provider and model in Settings first.");
      onOpenSettings();
      return;
    }

    setAttachments([]);
    attachmentIdsRef.current = files.map((file) => file.id);

    try {
      if (!sessionIdRef.current) {
        const { session: created } = await api.createSession({
          providerId,
          model,
        });
        sessionIdRef.current = created.id;
        onSessionCreated(created);
      } else {
        void api
          .updateSession(sessionIdRef.current, { providerId, model })
          .catch(() => undefined);
      }

      const prompt =
        text || (files.length > 0 ? "Please review the attached file(s)." : "");
      await sendMessage({
        text: prompt,
        metadata: files.length > 0 ? { attachments: files } : undefined,
      });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not start the chat.",
      );
    } finally {
      attachmentIdsRef.current = [];
    }
  }

  function handleModelChange(nextProviderId: string, nextModel: string) {
    setProviderId(nextProviderId);
    setModel(nextModel);
    if (sessionIdRef.current) {
      void api
        .updateSession(sessionIdRef.current, {
          providerId: nextProviderId,
          model: nextModel,
        })
        .catch(() => undefined);
    }
  }

  const modelPicker = (
    <ModelPicker
      providers={bootstrap.providers}
      providerId={providerId}
      model={model}
      onChange={handleModelChange}
      onOpenSettings={onOpenSettings}
    />
  );

  const composer = (
    <ComposerBar
      onSend={handleSend}
      attachments={attachments}
      onAttachFiles={(files) => handleFiles(files)}
      onRemoveAttachment={(id) =>
        setAttachments((current) =>
          current.filter((file) => file.id !== id),
        )
      }
      uploading={uploading}
      streaming={streaming}
      onStop={() => void stop()}
      modelPicker={modelPicker}
    />
  );

  return (
    <div className="flex h-svh min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
        <SidebarTrigger />
        <div className="flex min-w-0 items-center gap-1.5">
          {session?.pinned && (
            <PinIcon className="size-3 text-muted-foreground" />
          )}
          <span className="truncate font-medium text-sm">
            {session?.title ?? "New chat"}
          </span>
        </div>
        <div className="ms-auto flex items-center gap-1">
          {activeProvider && (
            <span className="hidden items-center gap-1.5 text-muted-foreground text-xs sm:flex">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-40" />
                <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
              </span>
              {activeProvider.name}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Settings"
            onClick={onOpenSettings}
          >
            <Settings2Icon />
          </Button>
        </div>
      </header>

      {messages.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center px-4 py-10">
            <div className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-foreground text-background shadow-lg/10">
              <span className="font-semibold text-2xl leading-none">m</span>
            </div>
            <h1 className="text-center font-semibold text-2xl tracking-tight sm:text-3xl">
              {greeting()}.
            </h1>
            <p className="mt-1.5 max-w-md text-center text-muted-foreground text-sm">
              Ask anything. Minimi can search the live web, read pages, and
              remember what matters from your conversations.
            </p>

            <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion.title}
                  type="button"
                  onClick={() => void handleSend(suggestion.prompt)}
                  className="flex items-start gap-2.5 rounded-xl border bg-card p-3 text-left transition-colors hover:bg-accent/40"
                >
                  <suggestion.icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block font-medium text-sm">
                      {suggestion.title}
                    </span>
                    <span className="mt-0.5 line-clamp-1 block text-muted-foreground text-xs">
                      {suggestion.prompt}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            <div className="mt-6 w-full">{composer}</div>
          </div>
        </div>
      ) : (
        <>
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className="relative min-h-0 flex-1 overflow-y-auto"
          >
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 py-6">
              {messages.map((message, index) => (
                <MessageItem
                  key={message.id}
                  message={message}
                  isLast={index === messages.length - 1}
                  streaming={streaming}
                  onRegenerate={() => void regenerate()}
                />
              ))}
              {error && !streaming && (
                <InlineError
                  message={error.message}
                  onRetry={() => void regenerate()}
                  onOpenSettings={onOpenSettings}
                />
              )}
              <div ref={bottomRef} />
            </div>
          </div>
          {!atBottom && (
            <div className="pointer-events-none sticky bottom-2 z-10 flex justify-center">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="Scroll to bottom"
                className="pointer-events-auto rounded-full shadow-sm"
                onClick={() => {
                  setAtBottom(true);
                  bottomRef.current?.scrollIntoView({ block: "end" });
                }}
              >
                <ArrowDownIcon />
              </Button>
            </div>
          )}
          <div className="shrink-0">{composer}</div>
        </>
      )}
    </div>
  );
}

function InlineError({
  message,
  onRetry,
  onOpenSettings,
}: {
  message: string;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <div className="mx-4 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
      <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-sm">The model request failed</div>
        <div className="mt-0.5 break-words text-muted-foreground text-xs">
          {message}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCwIcon />
            Try again
          </Button>
          <Button variant="ghost" size="sm" onClick={onOpenSettings}>
            Check provider settings
          </Button>
        </div>
      </div>
    </div>
  );
}
