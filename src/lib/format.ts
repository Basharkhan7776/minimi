import {
  format,
  isToday,
  isYesterday,
  isWithinInterval,
  subDays,
} from "date-fns";
import type { Session } from "./types";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatRelative(ms: number): string {
  const date = new Date(ms);
  if (isToday(date)) return format(date, "HH:mm");
  if (isYesterday(date)) return "Yesterday";
  if (isWithinInterval(date, { start: subDays(new Date(), 7), end: new Date() })) {
    return format(date, "EEE");
  }
  return format(date, "d MMM");
}

export function formatDate(iso?: string | null): string {
  if (!iso) return "Undated";
  const value = iso.trim();
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T12:00:00`
    : value;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return value;
  return format(date, "d MMM yyyy");
}

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function faviconUrl(url: string): string {
  try {
    const { hostname } = new URL(url);
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;
  } catch {
    return "";
  }
}

export interface SessionGroup {
  label: string;
  sessions: Session[];
}

export function groupSessions(sessions: Session[]): SessionGroup[] {
  const groups: SessionGroup[] = [
    { label: "Today", sessions: [] },
    { label: "Yesterday", sessions: [] },
    { label: "Previous 7 days", sessions: [] },
    { label: "Older", sessions: [] },
  ];
  const now = new Date();
  const weekAgo = subDays(now, 7);
  for (const session of sessions) {
    const date = new Date(session.updatedAt);
    if (isToday(date)) groups[0].sessions.push(session);
    else if (isYesterday(date)) groups[1].sessions.push(session);
    else if (isWithinInterval(date, { start: weekAgo, end: now })) {
      groups[2].sessions.push(session);
    } else groups[3].sessions.push(session);
  }
  return groups.filter((group) => group.sessions.length > 0);
}

export function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
