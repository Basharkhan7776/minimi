"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { localDateString } from "@/lib/reminders";
import type { Reminder } from "@/lib/types";

export function ReminderDialog({
  open,
  onOpenChange,
  reminder,
  sessionId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reminder?: Reminder | null;
  sessionId?: string | null;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(localDateString());
  const [dueTime, setDueTime] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(reminder?.title ?? "");
    setDueDate(reminder?.dueDate ?? localDateString());
    setDueTime(reminder?.dueTime ?? "");
    setUrl(reminder?.url ?? "");
    setNotes(reminder?.notes ?? "");
  }, [open, reminder]);

  async function save() {
    if (!title.trim()) {
      toast.error("Give the reminder a title.");
      return;
    }
    setSaving(true);
    try {
      if (reminder) {
        await api.updateReminder(reminder.id, {
          title: title.trim(),
          dueDate,
          dueTime: dueTime || null,
          url: url.trim() || null,
          notes: notes.trim() || null,
        });
        toast.success("Reminder updated.");
      } else {
        await api.createReminder({
          title: title.trim(),
          dueDate,
          dueTime: dueTime || null,
          url: url.trim() || null,
          notes: notes.trim() || null,
          sessionId: sessionId ?? null,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        toast.success("Reminder added to Second Brain.");
      }
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save the reminder.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="w-full max-w-md">
        <DialogHeader>
          <DialogTitle>{reminder ? "Edit reminder" : "New reminder"}</DialogTitle>
          <DialogDescription>
            A time notifies once, at that time on that date. Leave the time
            blank to remind all day, every 2 hours from 09:00 to 21:00.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="reminder-title">What needs doing?</Label>
            <Input
              id="reminder-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Email HR at Acme about the interview"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="reminder-date">Date</Label>
              <Input
                id="reminder-date"
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reminder-time">Time</Label>
              <Input
                id="reminder-time"
                type="time"
                value={dueTime}
                onChange={(event) => setDueTime(event.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reminder-url">Link (optional)</Label>
            <Input
              id="reminder-url"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reminder-notes">Notes (optional)</Label>
            <Textarea
              id="reminder-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Anything useful when the reminder fires."
            />
          </div>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button loading={saving} onClick={() => void save()}>
            {reminder ? "Save" : "Add reminder"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
