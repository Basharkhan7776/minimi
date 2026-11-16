import type { UIMessage } from "ai";

export interface Session {
  id: string;
  title: string;
  titleLocked: boolean;
  titleTurn: number;
  pinned: boolean;
  archived: boolean;
  providerId: string | null;
  model: string | null;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
}

export interface StoredMessage {
  id: string;
  sessionId: string;
  role: UIMessage["role"];
  content: string;
  parts: UIMessage["parts"];
  metadata?: unknown;
  createdAt: number;
  model?: string | null;
  usage?: unknown;
  error?: string | null;
}

export interface ProviderConfig {
  id: string;
  type: "openai" | "anthropic" | "google" | "openrouter" | "ollama" | "custom";
  name: string;
  baseUrl: string | null;
  apiKey: string | null;
  defaultModel: string | null;
  enabled: boolean;
  sortOrder: number;
  config: Record<string, unknown> | null;
}

export interface FileRecord {
  id: string;
  sessionId: string | null;
  messageId: string | null;
  name: string;
  mime: string;
  size: number;
  path: string;
  extractedText: string | null;
  createdAt: number;
}

export interface Reminder {
  id: string;
  sessionId: string | null;
  title: string;
  notes: string | null;
  url: string | null;
  dueDate: string;
  dueTime: string | null;
  timezone: string | null;
  status: "active" | "done";
  sourceMessageId: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  nextNudgeAt?: number | null;
  eventCount?: number;
}

export interface ReminderEvent {
  id: string;
  reminderId: string;
  kind: string;
  scheduledFor: number;
  status: "pending" | "fired" | "skipped" | "cancelled";
  firedAt: number | null;
  notifiedAt: number | null;
  createdAt: number;
  reminderTitle?: string;
  sessionId?: string | null;
}

export interface MemoryRecord {
  id: string;
  sessionId: string;
  messageId: string | null;
  kind: string;
  text: string;
  eventDate: string | null;
  createdAt: number;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string | null;
  content?: string;
  sourceId: string;
}
