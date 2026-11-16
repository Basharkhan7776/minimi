"use client";

import {
  AlertCircleIcon,
  BellIcon,
  BellRingIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
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
  onDelete,
}: {
  reminder: Reminder;
  onDone: (reminder: Reminder) => void;
  onOpenChat: (sessionId: string) => void;
  onEdit?: (reminder: Reminder) => void;
  onDelete?: (reminder: Reminder) => void;
}) {
  const isDone = reminder.status === "done";
  const overdue = !isDone && isReminderOverdue(reminder);
  const next = !isDone ? nextNudgeLabel(reminder) : null;
  const isSameTime =
    reminder.dueTime && next ? next.includes(reminder.dueTime) : false;

  return (
    <div
      className={cn(
        "group/reminder relative rounded-xl border border-white/[0.08] bg-[#1a1a1d] p-3.5 transition-all duration-150 hover:border-white/[0.16] hover:bg-[#202025]",
        overdue &&
          "border-destructive/35 bg-destructive/[0.03] hover:border-destructive/50",
        isDone && "border-white/[0.04] bg-white/[0.02] opacity-70 hover:opacity-95",
      )}
    >
      <div className="flex items-start gap-3">
        {/* Completion Checkbox */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDone(reminder);
          }}
          className={cn(
            "group/check mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isDone
              ? "border-emerald-500 bg-emerald-500 text-black hover:bg-emerald-400"
              : "border-white/25 bg-white/[0.03] text-transparent hover:border-emerald-500 hover:bg-emerald-500/15 hover:text-emerald-400",
          )}
          title={isDone ? "Mark as active" : "Mark as done"}
          aria-label={
            isDone
              ? `Mark "${reminder.title}" active`
              : `Mark "${reminder.title}" done`
          }
        >
          <CheckIcon
            className={cn(
              "size-3 stroke-[2.5]",
              !isDone && "opacity-0 group-hover/check:opacity-100 transition-opacity",
            )}
          />
        </button>

        {/* Content Body */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              onClick={() => onEdit?.(reminder)}
              className="text-start group/title focus-visible:outline-none"
            >
              <h4
                className={cn(
                  "font-medium text-sm leading-snug text-neutral-100 transition-colors group-hover/title:text-white",
                  isDone && "line-through text-neutral-400 group-hover/title:text-neutral-300",
                )}
              >
                {reminder.title}
              </h4>
            </button>

            {/* Action buttons */}
            <div className="flex shrink-0 items-center gap-0.5 -mt-1 -me-1">
              {reminder.url && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-7 text-[#8e8e96] hover:text-white hover:bg-white/[0.08]"
                  title={`Open ${reminder.url}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void openExternal(reminder.url!);
                  }}
                >
                  <ExternalLinkIcon className="size-3.5" />
                </Button>
              )}
              {reminder.sessionId && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-7 text-[#8e8e96] hover:text-white hover:bg-white/[0.08]"
                  title="Open conversation"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenChat(reminder.sessionId!);
                  }}
                >
                  <MessageSquareIcon className="size-3.5" />
                </Button>
              )}
              {onEdit && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-7 text-[#8e8e96] hover:text-white hover:bg-white/[0.08]"
                  title="Edit reminder"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(reminder);
                  }}
                >
                  <PencilIcon className="size-3.5" />
                </Button>
              )}
              {onDelete && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="size-7 text-[#8e8e96] hover:text-destructive hover:bg-destructive/15"
                  title="Delete reminder"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(reminder);
                  }}
                >
                  <Trash2Icon className="size-3.5" />
                </Button>
              )}
            </div>
          </div>

          {/* Badges and metadata */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {isDone ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
                <CheckIcon className="size-3 shrink-0" />
                Completed
              </span>
            ) : overdue ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/15 px-2 py-0.5 text-[11px] font-medium text-destructive">
                <AlertCircleIcon className="size-3 shrink-0" />
                Overdue · {formatReminderDue(reminder)}
              </span>
            ) : reminder.dueDate ? (
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium",
                  formatReminderDue(reminder).startsWith("Today")
                    ? "border-amber-500/25 bg-amber-500/10 text-amber-300"
                    : "border-white/[0.08] bg-white/[0.05] text-neutral-300",
                )}
              >
                {formatReminderDue(reminder).startsWith("Today") ? (
                  <ClockIcon className="size-3 shrink-0" />
                ) : (
                  <CalendarIcon className="size-3 shrink-0" />
                )}
                {formatReminderDue(reminder)}
              </span>
            ) : null}

            {next && !isSameTime && (
              <span className="inline-flex items-center gap-1 text-[11px] text-[#8e8e96]">
                <BellRingIcon className="size-2.5 opacity-70" />
                {next}
              </span>
            )}
          </div>

          {/* Notes description */}
          {reminder.notes && (
            <p className="mt-2.5 rounded-lg border border-white/[0.05] bg-white/[0.02] px-2.5 py-1.5 text-xs leading-relaxed text-[#a1a1aa] line-clamp-2">
              {reminder.notes}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function ReminderEmpty({
  title = "No reminders",
  text = "You're all caught up! Add a reminder or ask Minimi to remind you.",
  onAdd,
}: {
  title?: string;
  text?: string;
  onAdd?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] px-6 py-10 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-[#8e8e96] shadow-inner">
        <BellIcon className="size-5" />
      </div>
      <h4 className="font-medium text-neutral-200 text-sm">{title}</h4>
      <p className="mt-1 max-w-[240px] text-xs leading-relaxed text-[#8e8e96]">
        {text}
      </p>
      {onAdd && (
        <Button
          size="sm"
          variant="outline"
          onClick={onAdd}
          className="mt-4 gap-1.5 rounded-lg border-white/[0.1] bg-white/[0.04] text-xs text-neutral-200 hover:bg-white/[0.08] hover:text-white"
        >
          <PlusIcon className="size-3.5" />
          Add reminder
        </Button>
      )}
    </div>
  );
}
