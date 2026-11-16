export interface WebSource {
  id: string;
  title: string;
  url: string;
  publishedAt?: string | null;
  snippet?: string;
  content?: string;
}

export interface WebSearchOutput {
  queries?: string[];
  provider?: string;
  cached?: boolean;
  sources?: WebSource[];
  errors?: string[];
  note?: string;
}

export interface FetchUrlOutput {
  title?: string;
  url?: string;
  publishedAt?: string | null;
  text?: string;
  error?: string | null;
}

export interface MemoryHit {
  date?: string | null;
  kind?: string;
  text: string;
  session?: string;
}

export interface RecallMemoryOutput {
  from?: string | null;
  to?: string | null;
  hits?: MemoryHit[];
  note?: string;
}

export interface CreateReminderOutput {
  ok?: boolean;
  duplicate?: boolean;
  error?: string;
  note?: string;
  reminder?: {
    id: string;
    title: string;
    dueDate: string;
    dueTime?: string | null;
    url?: string | null;
    status?: string;
  };
}

export interface ToolPart {
  type: string;
  state: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

export function toolName(type: string): string {
  return type.startsWith("tool-") ? type.slice(5) : type;
}

export function isToolPart(part: { type: string }): boolean {
  return part.type.startsWith("tool-") || part.type === "dynamic-tool";
}

export function collectSources(
  messages: Array<{ parts: Array<{ type: string; output?: unknown }> }>,
): WebSource[] {
  const seen = new Set<string>();
  const sources: WebSource[] = [];
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool-web_search") continue;
      const output = part.output as WebSearchOutput | undefined;
      for (const source of output?.sources ?? []) {
        if (seen.has(source.id)) continue;
        seen.add(source.id);
        sources.push(source);
      }
    }
  }
  return sources;
}
