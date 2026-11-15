import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import "dotenv/config";

export const HOST = process.env.MINIMI_HOST ?? "127.0.0.1";
export const PORT = Number(process.env.MINIMI_PORT ?? 8787);

function resolveDataDir(): string {
  if (process.env.MINIMI_DATA_DIR) return path.resolve(process.env.MINIMI_DATA_DIR);
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA ?? os.homedir(), "minimi");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "minimi");
  }
  return path.join(
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
    "minimi",
  );
}

export const DATA_DIR = resolveDataDir();
export const DB_PATH = path.join(DATA_DIR, "minimi.db");
export const FILES_DIR = path.join(DATA_DIR, "files");

export function ensureDataDirs(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.mkdirSync(FILES_DIR, { recursive: true, mode: 0o700 });
}

export const EMBEDDING_DIM = 384;
export const EMBEDDING_MODEL = "bge-small-en-v1.5";
