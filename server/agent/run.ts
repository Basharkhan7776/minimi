import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type LanguageModel,
  type StreamTextResult,
  type UIMessage,
} from "ai";
import type { AgentTools } from "./tools";
import { nanoid } from "nanoid";
import { getSetting } from "../db";
import { getFilesByIds } from "../db/files";
import { extractText } from "../db/messages";
import type { FileRecord, Session } from "../db/types";
import { recallMemories, type MemoryHit } from "../memory";
import { listReminders } from "../db/reminders";
import { buildSystemPrompt } from "./prompt";
import { resolveSessionModel, type ResolvedModel } from "./providers";
import { createAgentTools } from "./tools";

export interface AgentRun {
  session: Session;
  resolved: ResolvedModel;
  assistantId: string;
  result: StreamTextResult<AgentTools, any, any>;
  userText: string;
  userMessageId: string | null;
  memories: MemoryHit[];
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

function lastUserMessage(messages: UIMessage[]): { id: string | null; text: string } {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const text = extractText(message.parts);
    if (text) return { id: message.id, text };
  }
  return { id: null, text: "" };
}

function contextText(messages: UIMessage[], maxMessages = 10): string {
  return messages
    .slice(-maxMessages)
    .map((message) => {
      const text = extractText(message.parts).slice(0, 1500);
      return text ? `${message.role === "user" ? "User" : "Assistant"}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export async function prepareAgentRun(input: {
  session: Session;
  messages: UIMessage[];
  attachmentIds?: string[];
  abortSignal?: AbortSignal;
}): Promise<AgentRun> {
  const resolved = resolveSessionModel(input.session);
  const lastUser = lastUserMessage(input.messages);
  const userText = lastUser.text;

  const files: FileRecord[] =
    input.attachmentIds && input.attachmentIds.length > 0
      ? getFilesByIds(input.attachmentIds)
      : [];

  const memories = await withTimeout(
    recallMemories({ query: userText, limit: 6 }),
    2500,
    [] as MemoryHit[],
  );

  const reminders = listReminders({ status: "active", limit: 12 });
  const userName = getSetting("user.name");
  const system = buildSystemPrompt({ memories, files, reminders, userName });
  const tools = createAgentTools({
    model: resolved.model,
    context: contextText(input.messages),
    userText,
    sessionId: input.session.id,
    userMessageId: lastUser.id,
  });

  const maxSteps = Number(getSetting("chat.maxSteps") ?? 8);
  const modelMessages = await convertToModelMessages(
    input.messages.slice(-40),
    { tools, ignoreIncompleteToolCalls: true },
  );

  const result = streamText({
    model: resolved.model,
    system,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(Math.max(1, maxSteps)),
    temperature: 0.4,
    maxRetries: 1,
    abortSignal: input.abortSignal,
    onError: ({ error }) => {
      console.error("[agent] stream error", error);
    },
  });

  return {
    session: input.session,
    resolved,
    assistantId: nanoid(16),
    result,
    userText,
    userMessageId: lastUser.id,
    memories,
  };
}

export { maybeGenerateTitle } from "./title";
export type { LanguageModel };
