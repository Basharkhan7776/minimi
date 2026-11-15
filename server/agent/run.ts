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
import { buildSystemPrompt } from "./prompt";
import { resolveSessionModel, type ResolvedModel } from "./providers";
import { createAgentTools } from "./tools";

export interface AgentRun {
  session: Session;
  resolved: ResolvedModel;
  assistantId: string;
  result: StreamTextResult<AgentTools, any, any>;
  userText: string;
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

function lastUserText(messages: UIMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    const text = extractText(message.parts);
    if (text) return text;
  }
  return "";
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
  const userText = lastUserText(input.messages);

  const files: FileRecord[] =
    input.attachmentIds && input.attachmentIds.length > 0
      ? getFilesByIds(input.attachmentIds)
      : [];

  const memories = await withTimeout(
    recallMemories({ query: userText, limit: 6 }),
    2500,
    [] as MemoryHit[],
  );

  const system = buildSystemPrompt({ memories, files });
  const tools = createAgentTools({
    model: resolved.model,
    context: contextText(input.messages),
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
    memories,
  };
}

export { maybeGenerateTitle } from "./title";
export type { LanguageModel };
