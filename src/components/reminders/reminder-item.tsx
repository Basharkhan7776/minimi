"use client";

import {
  BellIcon,
  CheckIcon,
  ExternalLinkIcon,
  MessageSquareIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { openExternal } from "@/lib/external";
import {
  formatReminderDue,
  isReminderOverdue,
  nextNudgeLabel,
} from "@/lib/reminders";
import type { Reminder } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ReminderItem({
  reminder,
  onDone,
  onOpenChat,
  onEdit,
}: {
  reminder: Reminder;
  onDone: (reminder: Reminder) => void;
  onOpenChat: (sessionId: string) => void;
  onEdit?: (reminder: Reminder) => void;
}) {
  const overdue = isReminderOverdue(reminder);
  const next = nextNudgeLabel(reminder);

  return (
    <div
      className={cn(
        "group/reminder rounded-lg border bg-card/60 px-2.5 py-2 transition-colors hover:bg-accent/40",
        overdue && "border-destructive/30",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => onDone(reminder)}
          className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border text-transparent transition-colors hover:border-emerald-500 hover:text-emerald-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Mark "${reminder.title}" done`}
        >
          <CheckIcon className="size-2.5" />
        </button>
        <button
          type="button"
          onClick={() => onEdit?.(reminder)}
          className="min-w-0 flex-1 text-start"
        >
          <div className="line-clamp-2 font-medium text-xs leading-snug">
            {reminder.title}
          </div>
          <div
            className={cn(
              "mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-muted-foreground",
              overdue && "text-destructive",
            )}
          >
            <span>{formatReminderDue(reminder)}</span>
            {overdue && <span>· Overdue</span>}
            {!overdue && next && <span className="truncate">· {next}</span>}
          </div>
          {reminder.notes && (
            <div className="mt-1 line-clamp-1 text-[10px] text-muted-foreground">
              {reminder.notes}
            </div>
          )}
        </button>
        <div className="flex shrink-0 items-center">
          {reminder.url && (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Open link"
              title={reminder.url}
              onClick={() => void openExternal(reminder.url!)}
            >
              <ExternalLinkIcon />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Open chat"
            disabled={!reminder.sessionId}
            onClick={() =>
              reminder.sessionId && onOpenChat(reminder.sessionId)
            }
          >
            <MessageSquareIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ReminderEmpty({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-1.5 px-2 py-1 text-[10px] text-muted-foreground">
      <BellIcon className="mt-0.5 size-3 shrink-0" />
      <span>{text}</span>
    </div>
  );
}
