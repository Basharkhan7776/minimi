"use client";

import { useState } from "react";
import {
  BrainIcon,
  ChevronDownIcon,
  FileTextIcon,
  GlobeIcon,
  Loader2Icon,
  SearchIcon,
  TriangleAlertIcon,
  WrenchIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate, hostnameOf } from "@/lib/format";
import { openExternal } from "@/lib/external";
import {
  type FetchUrlOutput,
  type RecallMemoryOutput,
  type ToolPart,
  type WebSearchOutput,
  toolName,
} from "@/lib/chat";
import { SourceFavicon } from "./sources";

function statusLine(part: ToolPart, name: string): string {
  const streaming =
    part.state === "input-streaming" || part.state === "input-available";
  if (streaming) {
    if (name === "web_search") return "Searching the web";
    if (name === "fetch_url") return "Reading page";
    if (name === "recall_memory") return "Searching memory";
    return "Running tool";
  }
  if (part.state === "output-error") return "Tool failed";
  if (name === "web_search") return "Searched the web";
  if (name === "fetch_url") return "Read page";
  if (name === "recall_memory") return "Recalled from memory";
  return "Used tool";
}

function statusDetail(part: ToolPart, name: string): string | null {
  if (part.state !== "output-available") return null;
  if (name === "web_search") {
    const output = part.output as WebSearchOutput | undefined;
    const count = output?.sources?.length ?? 0;
    const queries = output?.queries?.length ?? 0;
    if (count === 0) return "No results";
    return `${count} source${count === 1 ? "" : "s"}${queries > 1 ? ` · ${queries} queries` : ""}`;
  }
  if (name === "fetch_url") {
    const output = part.output as FetchUrlOutput | undefined;
    if (output?.error) return "Could not read";
    return output?.title ? hostnameOf(output.url ?? "") : null;
  }
  if (name === "recall_memory") {
    const output = part.output as RecallMemoryOutput | undefined;
    const count = output?.hits?.length ?? 0;
    return `${count} memor${count === 1 ? "y" : "ies"}`;
  }
  return null;
}

export function ToolCall({ part }: { part: ToolPart }) {
  const [open, setOpen] = useState(false);
  const name = toolName(part.type);
  const streaming =
    part.state === "input-streaming" || part.state === "input-available";
  const failed = part.state === "output-error";
  const detail = statusDetail(part, name);
  const input = part.input as Record<string, unknown> | undefined;

  const Icon =
    name === "web_search"
      ? SearchIcon
      : name === "fetch_url"
        ? FileTextIcon
        : name === "recall_memory"
          ? BrainIcon
          : WrenchIcon;

  return (
    <div className="my-2 overflow-hidden rounded-lg border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-accent/40"
      >
        <span
          className={cn(
            "flex size-5 items-center justify-center rounded-md",
            failed ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {streaming ? (
            <Loader2Icon className="size-3.5 animate-spin" />
          ) : failed ? (
            <TriangleAlertIcon className="size-3.5" />
          ) : (
            <Icon className="size-3.5" />
          )}
        </span>
        <span className="font-medium text-foreground/90">
          {statusLine(part, name)}
        </span>
        {detail && (
          <span className="truncate text-muted-foreground text-xs">
            {detail}
          </span>
        )}
        {stateChip(part, name)}
        <ChevronDownIcon
          className={cn(
            "ms-auto size-3.5 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="border-t px-3 py-2 text-xs">
          {input?.query != null && (
            <div className="mb-2 text-muted-foreground">
              <span className="font-medium text-foreground/70">Query: </span>
              {String(input.query) || "(date lookup)"}
            </div>
          )}
          {input?.url != null && (
            <button
              type="button"
              className="mb-2 block truncate text-left text-primary hover:underline"
              onClick={() => void openExternal(String(input.url))}
            >
              {String(input.url)}
            </button>
          )}
          <ToolDetails part={part} name={name} />
        </div>
      )}
    </div>
  );
}

function stateChip(part: ToolPart, name: string) {
  if (part.state !== "output-available") return null;
  if (name === "web_search") {
    const output = part.output as WebSearchOutput | undefined;
    if (output?.cached) {
      return (
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          cached
        </span>
      );
    }
  }
  return null;
}

function ToolDetails({ part, name }: { part: ToolPart; name: string }) {
  if (part.state === "output-error") {
    return (
      <div className="text-destructive">
        {part.errorText ?? "The tool returned an error."}
      </div>
    );
  }
  if (part.state !== "output-available") {
    return <div className="text-muted-foreground">Working…</div>;
  }

  if (name === "web_search") {
    const output = part.output as WebSearchOutput | undefined;
    return (
      <div className="space-y-2">
        {output?.queries && output.queries.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {output.queries.map((query) => (
              <span
                key={query}
                className="rounded-full bg-background px-2 py-0.5 text-[11px] text-muted-foreground ring-1 ring-border"
              >
                {query}
              </span>
            ))}
          </div>
        )}
        {output?.errors && output.errors.length > 0 && (
          <div className="text-muted-foreground">
            {output.errors.join(" · ")}
          </div>
        )}
        <div className="space-y-1.5">
          {(output?.sources ?? []).map((source, index) => (
            <button
              key={source.id}
              type="button"
              onClick={() => void openExternal(source.url)}
              className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-accent/50"
            >
              <span className="mt-0.5 text-[10px] text-muted-foreground tabular-nums">
                S{index + 1}
              </span>
              <SourceFavicon url={source.url} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-foreground/90">
                  {source.title || source.url}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {hostnameOf(source.url)}
                  {source.publishedAt ? ` · ${formatDate(source.publishedAt)}` : ""}
                </span>
              </span>
              <GlobeIcon className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
            </button>
          ))}
          {(!output?.sources || output.sources.length === 0) && (
            <div className="text-muted-foreground">
              {output?.note ?? "No results returned."}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (name === "fetch_url") {
    const output = part.output as FetchUrlOutput | undefined;
    if (output?.error) {
      return <div className="text-destructive">{output.error}</div>;
    }
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-foreground/80">
            {output?.title}
          </span>
          {output?.publishedAt && (
            <span className="text-[10px] text-muted-foreground">
              {formatDate(output.publishedAt)}
            </span>
          )}
        </div>
        <div className="max-h-56 overflow-y-auto whitespace-pre-wrap text-muted-foreground leading-relaxed">
          {output?.text?.slice(0, 2000)}
        </div>
      </div>
    );
  }

  if (name === "recall_memory") {
    const output = part.output as RecallMemoryOutput | undefined;
    return (
      <div className="space-y-2">
        {output?.note && (
          <div className="text-muted-foreground">{output.note}</div>
        )}
        {(output?.hits ?? []).map((hit, index) => (
          <div
            key={`${hit.text.slice(0, 24)}-${index}`}
            className="rounded-md bg-background/60 p-2 ring-1 ring-border"
          >
            <div className="mb-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
              {hit.date ? formatDate(hit.date) : "undated"}
              {hit.kind ? ` · ${hit.kind}` : ""}
              {hit.session ? ` · ${hit.session}` : ""}
            </div>
            <div className="line-clamp-3 text-foreground/80 leading-relaxed">
              {hit.text}
            </div>
          </div>
        ))}
        {(!output?.hits || output.hits.length === 0) && (
          <div className="text-muted-foreground">
            Nothing stored for that request.
          </div>
        )}
      </div>
    );
  }

  return (
    <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
      {JSON.stringify(part.output, null, 2)}
    </pre>
  );
}
