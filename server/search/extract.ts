import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type { SearchResult } from "../db/types";
import { boundedSignal } from "./signal";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

const MAX_BYTES = 2_500_000;
const MAX_CONTENT_CHARS = 7000;

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || host === "[::1]") return true;
  if (host.endsWith(".local")) return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}


function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return value;
}

function findDateInJson(value: unknown, depth = 0): string | null {
  if (!value || depth > 4) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDateInJson(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of ["datePublished", "dateCreated", "uploadDate"]) {
    if (typeof record[key] === "string") return record[key] as string;
  }
  return findDateInJson(record["@graph"], depth + 1);
}

function extractPublishedAt(document: Document): string | null {
  const selectors = [
    'meta[property="article:published_time"]',
    'meta[property="og:published_time"]',
    'meta[name="date"]',
    'meta[name="pubdate"]',
    'meta[name="publish-date"]',
    'meta[name="DC.date"]',
  ];
  for (const selector of selectors) {
    const content = document.querySelector(selector)?.getAttribute("content");
    const normalized = normalizeDate(content);
    if (normalized) return normalized;
  }

  const time = document.querySelector("time[datetime]")?.getAttribute("datetime");
  const normalizedTime = normalizeDate(time);
  if (normalizedTime) return normalizedTime;

  for (const script of Array.from(
    document.querySelectorAll('script[type="application/ld+json"]'),
  )) {
    try {
      const parsed = JSON.parse(script.textContent ?? "");
      const date = normalizeDate(findDateInJson(parsed));
      if (date) return date;
    } catch {
      // Ignore malformed structured data.
    }
  }
  return null;
}

async function readLimited(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer.slice(0, maxBytes));
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const remaining = maxBytes - received;
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining));
        received += remaining;
        break;
      }
      chunks.push(value);
      received += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function extractPage(
  url: string,
  options?: { signal?: AbortSignal },
): Promise<{
  title: string;
  text: string;
  siteName: string;
  url: string;
  publishedAt?: string | null;
  error?: string;
}> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      title: url,
      text: "",
      siteName: "",
      url,
      publishedAt: null,
      error: "Invalid URL",
    };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return {
      title: url,
      text: "",
      siteName: "",
      url,
      publishedAt: null,
      error: "Unsupported protocol",
    };
  }
  if (isPrivateHost(parsed.hostname)) {
    return {
      title: url,
      text: "",
      siteName: "",
      url,
      publishedAt: null,
      error: "Blocked private network address",
    };
  }

  try {
    const signal = boundedSignal(options?.signal, 9000);
    let response: Response | null = null;
    for (let hop = 0; hop <= 4; hop += 1) {
      if (isPrivateHost(parsed.hostname)) {
        return {
          title: parsed.hostname,
          text: "",
          siteName: parsed.hostname,
          url: parsed.toString(),
          publishedAt: null,
          error: "Blocked private network address",
        };
      }
      response = await fetch(parsed.toString(), {
        redirect: "manual",
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        },
        signal,
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      if (!location) break;
      const next = new URL(location, parsed);
      if (!["http:", "https:"].includes(next.protocol)) {
        return {
          title: parsed.hostname,
          text: "",
          siteName: parsed.hostname,
          url: parsed.toString(),
          publishedAt: null,
          error: "Unsupported redirect protocol",
        };
      }
      parsed = next;
      response = null;
    }
    if (!response) {
      return {
        title: parsed.hostname,
        text: "",
        siteName: parsed.hostname,
        url: parsed.toString(),
        publishedAt: null,
        error: "Too many redirects",
      };
    }
    if (!response.ok) {
      return {
        title: parsed.hostname,
        text: "",
        siteName: parsed.hostname,
        url: parsed.toString(),
        publishedAt: null,
        error: `HTTP ${response.status}`,
      };
    }
    const contentType = response.headers.get("content-type") ?? "";
    const bytes = await readLimited(response, MAX_BYTES);
    const charset =
      contentType.match(/charset=([^;]+)/i)?.[1]?.trim() ?? "utf-8";
    let html: string;
    try {
      html = new TextDecoder(charset).decode(bytes);
    } catch {
      html = new TextDecoder("utf-8").decode(bytes);
    }

    if (!contentType.includes("html") && !contentType.includes("text")) {
      return {
        title: parsed.hostname,
        text: html.slice(0, MAX_CONTENT_CHARS),
        siteName: parsed.hostname,
        url: parsed.toString(),
        publishedAt: null,
      };
    }

    const { document } = parseHTML(html);
    const publishedAt = extractPublishedAt(document);
    const reader = new Readability(document as unknown as Document, {
      charThreshold: 200,
    });
    const article = reader.parse();
    const text = (article?.textContent ?? document.body?.textContent ?? "")
      .replace(/\s+/g, " ")
      .replace(/(\s*\n\s*)+/g, "\n")
      .trim()
      .slice(0, MAX_CONTENT_CHARS);

    return {
      title: article?.title?.trim() || parsed.hostname,
      text,
      siteName: article?.siteName?.trim() || parsed.hostname,
      url: parsed.toString(),
      publishedAt,
    };
  } catch (error) {
    return {
      title: parsed.hostname,
      text: "",
      siteName: parsed.hostname,
      url: parsed.toString(),
      publishedAt: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function enrichResults(
  results: SearchResult[],
  options?: { maxPages?: number; signal?: AbortSignal },
): Promise<SearchResult[]> {
  const maxPages = options?.maxPages ?? 3;
  const selected = results.slice(0, maxPages);
  const enhanced = await Promise.all(
    selected.map(async (result) => {
      const page = await extractPage(result.url, { signal: options?.signal });
      return {
        ...result,
        title: page.title || result.title,
        content: page.text || undefined,
        publishedAt: page.publishedAt ?? result.publishedAt ?? null,
        snippet: result.snippet || page.text.slice(0, 300),
      };
    }),
  );
  return [...enhanced, ...results.slice(maxPages)];
}
