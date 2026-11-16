"use client";

import { useState } from "react";
import { Streamdown } from "streamdown";
import {
  BrainIcon,
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  FileIcon,
  RefreshCwIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { API_BASE } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { openExternal } from "@/lib/external";
import type {
  AttachmentMeta,
  ChatUIMessage,
} from "@/lib/types";
import { type ToolPart, isToolPart } from "@/lib/chat";
import { ToolCall } from "./tool-call";
import { SourcesPanel } from "./sources";
import type { WebSource } from "@/lib/chat";

type Part = ChatUIMessage["parts"][number] & {
  text?: string;
  state?: string;
  output?: unknown;
  input?: unknown;
  errorText?: string;
};

export function MessageItem({
  message,
  isLast,
  streaming,
  onRegenerate,
}: {
  message: ChatUIMessage;
  isLast: boolean;
  streaming: boolean;
  onRegenerate: () => void;
}) {
  const parts = message.parts as Part[];
  const attachments = message.metadata?.attachments ?? [];

  if (message.role === "user") {
    const text = parts
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("\n");
    return (
      <div className="flex justify-end px-4">
        <div className="max-w-[86%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-foreground shadow-xs/5">
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((file) => (
                <AttachmentChip key={file.id} file={file} />
              ))}
            </div>
          )}
          {text && (
            <div className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
              {text}
            </div>
          )}
        </div>
      </div>
    );
  }

  const hasContent = parts.some(
    (part) =>
      (part.type === "text" && part.text?.trim()) ||
      part.type === "reasoning" ||
      isToolPart(part),
  );

  return (
    <div className="group/message flex gap-3 px-4">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-white p-1 shadow-xs border border-border/40">
        <img src="/minimi.svg" alt="Minimi" className="size-full object-contain" />
      </div>
      <div className="min-w-0 flex-1">
        {!hasContent && streaming && <ThinkingLoader />}
        {parts.map((part, index) => {
          if (part.type === "text") {
            if (!part.text?.trim()) return null;
            return (
              <Streamdown
                key={index}
                className="streamdown-root max-w-none text-[15px] leading-relaxed"
              >
                {part.text}
              </Streamdown>
            );
          }
          if (part.type === "reasoning") {
            return (
              <Reasoning
                key={index}
                text={part.text ?? ""}
                streaming={streaming && isLast}
              />
            );
          }
          if (isToolPart(part)) {
            return <ToolCall key={index} part={part as ToolPart} />;
          }
          if (part.type === "file") {
            return null;
          }
          return null;
        })}

        {streaming && isLast && hasContent && <StreamingCursor />}
        <SourcesPanel sources={sourcesForMessage(parts)} />

        {!streaming && (
          <div className="mt-2 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/message:opacity-100 focus-within:opacity-100">
            <CopyButton message={message} />
            {isLast && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Regenerate response"
                title="Regenerate"
                onClick={onRegenerate}
              >
                <RefreshCwIcon />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function sourcesForMessage(parts: Part[]): WebSource[] {
  const seen = new Set<string>();
  const sources: WebSource[] = [];
  for (const part of parts) {
    if (part.type !== "tool-web_search") continue;
    const output = part.output as { sources?: WebSource[] } | undefined;
    for (const source of output?.sources ?? []) {
      if (seen.has(source.id)) continue;
      seen.add(source.id);
      sources.push(source);
    }
  }
  for (const part of parts) {
    if (part.type !== "source-url") continue;
    const source = part as unknown as { sourceId: string; url: string; title?: string };
    if (seen.has(source.sourceId)) continue;
    seen.add(source.sourceId);
    sources.push({ id: source.sourceId, title: source.title ?? source.url, url: source.url });
  }
  return sources;
}

function Reasoning({ text, streaming }: { text: string; streaming: boolean }) {
  const [open, setOpen] = useState(false);
  if (!text.trim()) return null;
  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground"
      >
        {streaming ? (
          <Spinner className="size-3.5 text-foreground/80" />
        ) : (
          <BrainIcon className="size-3.5" />
        )}
        {streaming ? "Thinking…" : "Thought process"}
        <span className="text-[10px]">{open ? "hide" : "show"}</span>
      </button>
      {open && (
        <div className="mt-1.5 border-s-2 ps-3 text-muted-foreground text-sm leading-relaxed whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}

function ThinkingLoader() {
  return (
    <div className="flex h-7 items-center gap-2 text-muted-foreground text-xs">
      <Spinner className="size-3.5 text-foreground/70" />
      <span>Thinking…</span>
    </div>
  );
}

function StreamingCursor() {
  return (
    <span className="ms-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-foreground/50 align-text-bottom" />
  );
}

function CopyButton({ message }: { message: ChatUIMessage }) {
  const [copied, setCopied] = useState(false);
  const text = (message.parts as Part[])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");

  async function copy() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is unavailable in some webviews.
    }
  }

  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label="Copy response"
      title="Copy"
      onClick={() => void copy()}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

export function AttachmentChip({
  file,
  onRemove,
}: {
  file: AttachmentMeta;
  onRemove?: () => void;
}) {
  return (
    <div className="flex max-w-full items-center gap-1.5 rounded-lg border bg-background/70 px-2 py-1 text-xs">
      <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 truncate font-medium">{file.name}</span>
      <span className="shrink-0 text-muted-foreground">
        {formatBytes(file.size)}
      </span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="ms-0.5 rounded text-muted-foreground hover:text-foreground"
          aria-label={`Remove ${file.name}`}
        >
          ×
        </button>
      ) : (
        <button
          type="button"
          onClick={() => void openExternal(`${API_BASE}/api/files/${file.id}`)}
          className="ms-0.5 rounded text-muted-foreground hover:text-foreground"
          aria-label={`Download ${file.name}`}
        >
          <DownloadIcon className="size-3" />
        </button>
      )}
    </div>
  );
}
