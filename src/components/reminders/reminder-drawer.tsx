"use client";

import { useState } from "react";
import { BellIcon, PlusIcon } from "lucide-react";
import {
  Drawer,
  DrawerDescription,
  DrawerHeader,
  DrawerPanel,
  DrawerPopup,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { activeReminders, doneReminders } from "@/lib/reminders";
import type { Reminder } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ReminderEmpty, ReminderItem } from "./reminder-item";

export function ReminderDrawer({
  open,
  onOpenChange,
  reminders,
  onAdd,
  onDone,
  onDelete,
  onOpenChat,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reminders: Reminder[];
  onAdd: () => void;
  onDone: (reminder: Reminder) => void;
  onDelete?: (reminder: Reminder) => void;
  onOpenChat: (sessionId: string) => void;
  onEdit: (reminder: Reminder) => void;
}) {
  const [tab, setTab] = useState<"active" | "done">("active");

  const active = activeReminders(reminders);
  const completed = doneReminders(reminders);

  return (
    <Drawer open={open} onOpenChange={onOpenChange} position="right">
      <DrawerPopup
        showCloseButton
        className="w-full sm:max-w-[420px] bg-[#161619] border-s border-white/[0.08] shadow-2xl"
      >
        <DrawerHeader className="pe-12 pb-4 border-b border-white/[0.06]">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.05] text-white shadow-inner">
              <BellIcon className="size-4 text-neutral-200" />
            </div>
            <div>
              <DrawerTitle className="flex items-center gap-2 font-semibold text-base text-white tracking-tight">
                Notifications
                {active.length > 0 && (
                  <span className="rounded-full border border-white/10 bg-white/10 px-2 py-0.5 font-medium text-neutral-300 text-xs">
                    {active.length}
                  </span>
                )}
              </DrawerTitle>
              <DrawerDescription className="mt-0.5 text-[#8e8e96] text-xs">
                Reminders & nudges from your Second Brain
              </DrawerDescription>
            </div>
          </div>
        </DrawerHeader>

        <DrawerPanel className="space-y-3.5 pt-3.5">
          {/* Segmented Filter Tabs */}
          <div className="flex items-center rounded-lg border border-white/[0.06] bg-white/[0.03] p-1">
            <button
              type="button"
              onClick={() => setTab("active")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-xs transition-all",
                tab === "active"
                  ? "bg-white/10 text-white shadow-sm"
                  : "text-[#8e8e96] hover:text-neutral-200",
              )}
            >
              <span>Active</span>
              {active.length > 0 && (
                <span className="rounded-full bg-white/10 px-1.5 py-0.2 font-semibold text-[10px] text-neutral-300">
                  {active.length}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setTab("done")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 font-medium text-xs transition-all",
                tab === "done"
                  ? "bg-white/10 text-white shadow-sm"
                  : "text-[#8e8e96] hover:text-neutral-200",
              )}
            >
              <span>Completed</span>
              {completed.length > 0 && (
                <span className="rounded-full bg-white/10 px-1.5 py-0.2 font-semibold text-[10px] text-neutral-300">
                  {completed.length}
                </span>
              )}
            </button>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between gap-3 px-0.5">
            <div className="flex items-center gap-1.5 text-xs text-[#8e8e96]">
              {tab === "active" ? (
                <>
                  <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span>
                    <strong className="font-medium text-neutral-200">
                      {active.length}
                    </strong>{" "}
                    active reminder{active.length === 1 ? "" : "s"}
                  </span>
                </>
              ) : (
                <span>
                  <strong className="font-medium text-neutral-200">
                    {completed.length}
                  </strong>{" "}
                  completed reminder{completed.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <Button
              size="sm"
              className="ms-auto h-8 gap-1.5 rounded-lg bg-white px-3 font-medium text-black text-xs shadow-sm hover:bg-neutral-200 transition-all"
              onClick={onAdd}
            >
              <PlusIcon className="size-3.5" />
              Add reminder
            </Button>
          </div>

          {/* List Area */}
          {tab === "active" ? (
            active.length === 0 ? (
              <ReminderEmpty
                title="All caught up"
                text="No active reminders right now. Ask Minimi in chat to set a reminder or add one here."
                onAdd={onAdd}
              />
            ) : (
              <div className="space-y-2">
                {active.map((reminder) => (
                  <ReminderItem
                    key={reminder.id}
                    reminder={reminder}
                    onDone={onDone}
                    onDelete={onDelete}
                    onOpenChat={onOpenChat}
                    onEdit={onEdit}
                  />
                ))}
              </div>
            )
          ) : completed.length === 0 ? (
            <ReminderEmpty
              title="No completed reminders"
              text="Reminders you mark as done will appear here. You can reopen them at any time."
            />
          ) : (
            <div className="space-y-2">
              {completed.map((reminder) => (
                <ReminderItem
                  key={reminder.id}
                  reminder={reminder}
                  onDone={onDone}
                  onDelete={onDelete}
                  onOpenChat={onOpenChat}
                  onEdit={onEdit}
                />
              ))}
            </div>
          )}
        </DrawerPanel>
      </DrawerPopup>
    </Drawer>
  );
}
