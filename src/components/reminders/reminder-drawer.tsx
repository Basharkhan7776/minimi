"use client";

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
import { activeReminders } from "@/lib/reminders";
import type { Reminder } from "@/lib/types";
import { ReminderEmpty, ReminderItem } from "./reminder-item";

export function ReminderDrawer({
  open,
  onOpenChange,
  reminders,
  onAdd,
  onDone,
  onOpenChat,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reminders: Reminder[];
  onAdd: () => void;
  onDone: (reminder: Reminder) => void;
  onOpenChat: (sessionId: string) => void;
  onEdit: (reminder: Reminder) => void;
}) {
  const active = activeReminders(reminders);

  return (
    <Drawer open={open} onOpenChange={onOpenChange} position="right">
      <DrawerPopup showCloseButton>
        <DrawerHeader className="pe-12">
          <DrawerTitle className="flex items-center gap-2">
            <BellIcon className="size-5" />
            Notifications
            {active.length > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary text-xs">
                {active.length}
              </span>
            )}
          </DrawerTitle>
          <DrawerDescription>
            Reminders from your Second Brain. They notify while Minimi is
            running.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerPanel className="space-y-3 pt-0">
          <div className="flex items-center justify-between gap-3">
            {active.length > 0 && (
              <span className="text-muted-foreground text-xs">
                {active.length} active reminder
                {active.length === 1 ? "" : "s"}
              </span>
            )}
            <Button size="sm" className="ms-auto" onClick={onAdd}>
              <PlusIcon />
              Add reminder
            </Button>
          </div>
          {active.length === 0 ? (
            <ReminderEmpty text="No reminders yet. Add one here or ask Minimi to remind you." />
          ) : (
            <div className="space-y-1.5">
              {active.map((reminder) => (
                <ReminderItem
                  key={reminder.id}
                  reminder={reminder}
                  onDone={onDone}
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
