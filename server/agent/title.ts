import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { getSetting } from "../db";
import { getStoredMessages } from "../db/messages";
import {
  countUserMessages,
  getSession,
  setAutoTitle,
} from "../db/sessions";

const titleSchema = z.object({
  rename: z
    .boolean()
    .describe("True only when the new title is clearly better than the current one."),
  title: z
    .string()
    .describe("A concise 2-6 word title, no quotes, no trailing punctuation."),
});

export async function maybeGenerateTitle(input: {
  model: LanguageModel;
  sessionId: string;
  userText: string;
  assistantText: string;
}): Promise<void> {
  if (getSetting("chat.autoTitle") === "0") return;
  const session = getSession(input.sessionId);
  if (!session || session.titleLocked) return;

  const userTurns = countUserMessages(input.sessionId);
  const isFirstTitle = session.title === "New chat";
  if (!isFirstTitle && userTurns - session.titleTurn < 6) return;

  try {
    const recent = getStoredMessages(input.sessionId)
      .slice(-6)
      .map((message) => {
        const content = message.content.slice(0, 1600);
        return content
          ? `${message.role === "user" ? "User" : "Assistant"}: ${content}`
          : "";
      })
      .filter(Boolean)
      .join("\n\n");

    const context =
      recent ||
      `User: ${input.userText.slice(0, 1600)}\nAssistant: ${input.assistantText.slice(0, 1600)}`;

    const { object } = await generateObject({
      model: input.model,
      schema: titleSchema,
      temperature: 0.2,
      maxOutputTokens: 400,
      abortSignal: AbortSignal.timeout(12000),
      system:
        "You name conversations. A title is 2-6 words, specific, and useful in a sidebar. No quotes, no trailing punctuation. Do not rename just because a new message arrived: keep the current title unless the conversation's main subject has clearly changed or the title is vague.",
      prompt: `Current title: ${session.title}\n\nRecent conversation:\n${context}\n\nReturn the best title and whether it should replace the current one. If the current title is "New chat", rename must be true.`,
    });

    const title = object.title
      .trim()
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .replace(/[.?!:;]+$/g, "")
      .slice(0, 72);
    if (!title) return;
    if (!object.rename && !isFirstTitle) return;
    setAutoTitle(input.sessionId, title, userTurns);
  } catch (error) {
    console.error("[agent] title generation failed", error);
  }
}
