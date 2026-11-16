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

export interface PublicProvider {
  id: string;
  type:
    | "openai"
    | "anthropic"
    | "google"
    | "openrouter"
    | "ollama"
    | "custom";
  name: string;
  baseUrl: string | null;
  defaultModel: string | null;
  enabled: boolean;
  sortOrder: number;
  hasApiKey: boolean;
  apiKeyPreview: string | null;
}

export interface AttachmentMeta {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export interface EmbeddingStatus {
  state: "idle" | "loading" | "ready" | "error";
  model: string;
  dimension: number;
  error?: string;
}

export interface MemoryStats {
  memories: number;
  messages: number;
  sessions: number;
  embeddingEnabled: boolean;
}

export interface BootstrapData {
  providers: PublicProvider[];
  defaultProviderId: string | null;
  defaultModel: string | null;
  settings: Record<string, string>;
  embedding: EmbeddingStatus;
  memory: MemoryStats;
  reminders: { active: number };
}

export interface ReminderEvent {
  id: string;
  reminderId: string;
  kind: "day_hour" | "time_pre" | "time_due" | "time_post" | string;
  scheduledFor: number;
  status: "pending" | "fired" | "skipped" | "cancelled";
  firedAt: number | null;
  notifiedAt: number | null;
  createdAt: number;
  reminderTitle?: string;
  sessionId?: string | null;
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
  nextNudgeAt: number | null;
  eventCount: number;
  events?: ReminderEvent[];
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

export type ChatMetadata = {
  attachments?: AttachmentMeta[];
};

export type ChatUIMessage = UIMessage<ChatMetadata>;

export interface SessionDetail {
  session: Session;
  messages: ChatUIMessage[];
}
