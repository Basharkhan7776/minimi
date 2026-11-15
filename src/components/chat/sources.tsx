"use client";

import { ExternalLinkIcon, GlobeIcon } from "lucide-react";
import { faviconUrl, hostnameOf } from "@/lib/format";
import { openExternal } from "@/lib/external";
import type { WebSource } from "@/lib/chat";

export function SourceFavicon({ url }: { url: string }) {
  return (
    <span className="relative flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">
      <GlobeIcon className="absolute size-3 text-muted-foreground" />
      <img
        src={faviconUrl(url)}
        alt=""
        loading="lazy"
        className="relative size-4 object-contain"
        onError={(event) => {
          event.currentTarget.style.display = "none";
        }}
      />
    </span>
  );
}

export function SourcesPanel({ sources }: { sources: WebSource[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-2 font-medium text-muted-foreground text-xs">
        Sources
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {sources.length}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {sources.map((source, index) => (
          <button
            key={source.id}
            type="button"
            onClick={() => void openExternal(source.url)}
            className="group flex min-w-0 flex-col rounded-lg border bg-card p-2.5 text-left transition-colors hover:bg-accent/40"
          >
            <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
              <SourceFavicon url={source.url} />
              <span className="truncate">{hostnameOf(source.url)}</span>
              <span className="ms-auto shrink-0 tabular-nums">
                S{index + 1}
              </span>
            </div>
            <div className="mt-1 line-clamp-2 font-medium text-foreground text-sm leading-snug">
              {source.title || source.url}
            </div>
            {source.snippet && (
              <div className="mt-1 line-clamp-2 text-muted-foreground text-xs leading-relaxed">
                {source.snippet}
              </div>
            )}
            <ExternalLinkIcon className="mt-2 size-3 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ))}
      </div>
    </div>
  );
}
