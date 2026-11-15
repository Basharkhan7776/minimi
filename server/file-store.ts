import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import { FILES_DIR, ensureDataDirs } from "./config";
import { createFileRecord } from "./db/files";
import type { FileRecord } from "./db/types";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

function safeName(name: string): string {
  return name.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "file";
}

async function extractText(
  name: string,
  mime: string,
  buffer: Buffer,
): Promise<string | null> {
  const lower = name.toLowerCase();
  try {
    if (mime === "application/pdf" || lower.endsWith(".pdf")) {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        const result = await parser.getText();
        return result.text.trim();
      } finally {
        await parser.destroy();
      }
    }
    if (
      mime ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      lower.endsWith(".docx")
    ) {
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({ buffer });
      return result.value.trim();
    }
    if (
      mime.startsWith("text/") ||
      mime === "application/json" ||
      ["application/xml", "application/x-yaml"].includes(mime) ||
      /\.(txt|md|markdown|csv|tsv|json|ya?ml|xml|html?|css|js|ts|tsx|jsx|py|rs|go|java|c|cpp|h|sh|sql|toml|ini)$/i.test(
        name,
      )
    ) {
      return buffer.toString("utf8").trim();
    }
  } catch (error) {
    console.error("[files] extraction failed", name, error);
  }
  return null;
}

export async function saveUploadedFile(input: {
  file: File;
  sessionId?: string | null;
  messageId?: string | null;
}): Promise<FileRecord> {
  ensureDataDirs();
  if (input.file.size > MAX_FILE_BYTES) {
    throw new Error("File is larger than the 25 MB limit.");
  }
  const buffer = Buffer.from(await input.file.arrayBuffer());
  const id = nanoid(12);
  const filename = `${id}-${safeName(input.file.name || "file")}`;
  const filePath = path.join(FILES_DIR, filename);
  fs.writeFileSync(filePath, buffer, { mode: 0o600 });

  const extracted = await extractText(
    input.file.name || "file",
    input.file.type || "application/octet-stream",
    buffer,
  );

  return createFileRecord({
    id,
    sessionId: input.sessionId ?? null,
    messageId: input.messageId ?? null,
    name: input.file.name || "file",
    mime: input.file.type || "application/octet-stream",
    size: input.file.size,
    path: filePath,
    extractedText: extracted,
  });
}

export function removeStoredFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore missing files
  }
}
