import { generateText, type LanguageModel } from "ai";
import { getDb, getSetting } from "../db";
import { getSession } from "../db/sessions";

export async function maybeGenerateTitle(input: {
  model: LanguageModel;
  sessionId: string;
  userText: string;
  assistantText: string;
}): Promise<void> {
  if (getSetting("chat.autoTitle") === "0") return;
  const session = getSession(input.sessionId);
  if (!session) return;
  if (session.title !== "New chat") return;

  try {
    const { text } = await generateText({
      model: input.model,
      temperature: 0.2,
      maxOutputTokens: 24,
      abortSignal: AbortSignal.timeout(12000),
      prompt: `Write a concise title (2-6 words, no quotes, no trailing punctuation) for this chat.\n\nUser: ${input.userText.slice(0, 1200)}\nAssistant: ${input.assistantText.slice(0, 1200)}`,
    });
    const title = text
      .trim()
      .replace(/^["'“”]+|["'“”]+$/g, "")
      .replace(/[.?!:;]+$/g, "")
      .slice(0, 72);
    if (!title) return;
    getDb()
      .prepare(
        "UPDATE sessions SET title = ? WHERE id = ? AND title = 'New chat'",
      )
      .run(title, input.sessionId);
  } catch (error) {
    console.error("[agent] title generation failed", error);
  }
}
