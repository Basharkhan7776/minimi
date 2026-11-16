import * as cheerio from "cheerio";
import type { SearchResult } from "../db/types";
import { boundedSignal } from "./signal";

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

export type Freshness = "any" | "day" | "week" | "month" | "year";

function normalizeUrl(href: string): string {
  try {
    if (href.startsWith("//")) href = `https:${href}`;
    const url = new URL(href, "https://duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    return url.toString();
  } catch {
    return href;
  }
}

function freshnessParam(freshness: Freshness | undefined): string | null {
  switch (freshness) {
    case "day":
      return "d";
    case "week":
      return "w";
    case "month":
      return "m";
    case "year":
      return "y";
    default:
      return null;
  }
}

async function requestDuckDuckGo(
  query: string,
  freshness: Freshness | undefined,
  signal: AbortSignal,
): Promise<string> {
  const body = new URLSearchParams({ q: query });
  const df = freshnessParam(freshness);
  if (df) body.set("df", df);

  const response = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": USER_AGENT,
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
    },
    body: body.toString(),
    signal,
  });
  if (!response.ok) {
    throw new Error(`DuckDuckGo returned ${response.status}`);
  }
  return response.text();
}

export async function duckDuckGoSearch(options: {
  query: string;
  maxResults?: number;
  freshness?: Freshness;
  signal?: AbortSignal;
}): Promise<SearchResult[]> {
  const maxResults = options.maxResults ?? 5;
  const signal = boundedSignal(options.signal, 12000);
  const html = await requestDuckDuckGo(
    options.query,
    options.freshness,
    signal,
  );
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];

  $(".result").each((_, element) => {
    if (results.length >= maxResults) return;
    const node = $(element);
    const link = node.find(".result__a").first();
    const href = link.attr("href");
    if (!href) return;
    const url = normalizeUrl(href);
    if (!url.startsWith("http")) return;
    const title = link.text().trim();
    if (!title) return;
    const snippet = node.find(".result__snippet").text().trim();
    const timestamp = node.find(".result__timestamp").text().trim();
    results.push({
      title,
      url,
      snippet,
      publishedAt: timestamp || null,
      sourceId: "",
    });
  });

  if (results.length === 0) {
    return liteSearch(options);
  }
  return results;
}

async function liteSearch(options: {
  query: string;
  maxResults?: number;
  freshness?: Freshness;
  signal?: AbortSignal;
}): Promise<SearchResult[]> {
  const maxResults = options.maxResults ?? 5;
  const signal = boundedSignal(options.signal, 12000);
  const params = new URLSearchParams({ q: options.query });
  const df = freshnessParam(options.freshness);
  if (df) params.set("df", df);
  const response = await fetch(
    `https://lite.duckduckgo.com/lite/?${params.toString()}`,
    {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
      signal,
    },
  );
  if (!response.ok) throw new Error(`DuckDuckGo lite returned ${response.status}`);
  const html = await response.text();
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];

  $("a.result-link").each((_, element) => {
    if (results.length >= maxResults) return;
    const link = $(element);
    const href = link.attr("href");
    if (!href) return;
    const url = normalizeUrl(href);
    if (!url.startsWith("http")) return;
    const title = link.text().trim();
    if (!title) return;
    const snippet = link
      .closest("tr")
      .next("tr")
      .find(".result-snippet")
      .text()
      .trim();
    results.push({ title, url, snippet, sourceId: "" });
  });

  return results;
}

function tavilyDays(freshness: Freshness | undefined): number | undefined {
  switch (freshness) {
    case "day":
      return 1;
    case "week":
      return 7;
    case "month":
      return 31;
    case "year":
      return 365;
    default:
      return undefined;
  }
}

export async function tavilySearch(options: {
  query: string;
  maxResults?: number;
  apiKey: string;
  freshness?: Freshness;
  signal?: AbortSignal;
}): Promise<SearchResult[]> {
  const days = tavilyDays(options.freshness);
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: options.apiKey,
      query: options.query,
      max_results: options.maxResults ?? 5,
      search_depth: "basic",
      include_answer: false,
      ...(days ? { days } : {}),
    }),
    signal: boundedSignal(options.signal, 12000),
  });
  if (!response.ok) throw new Error(`Tavily returned ${response.status}`);
  const data = (await response.json()) as {
    results?: Array<{ title: string; url: string; content: string }>;
  };
  return (data.results ?? []).map((result) => ({
    title: result.title,
    url: result.url,
    snippet: result.content,
    sourceId: "",
  }));
}

export async function braveSearch(options: {
  query: string;
  maxResults?: number;
  apiKey: string;
  freshness?: Freshness;
  signal?: AbortSignal;
}): Promise<SearchResult[]> {
  const params = new URLSearchParams({
    q: options.query,
    count: String(options.maxResults ?? 5),
  });
  if (options.freshness && options.freshness !== "any") {
    const map: Record<string, string> = {
      day: "pd",
      week: "pw",
      month: "pm",
      year: "py",
    };
    params.set("freshness", map[options.freshness] ?? "");
  }
  const response = await fetch(
    `https://api.search.brave.com/res/v1/web/search?${params.toString()}`,
    {
      headers: {
        accept: "application/json",
        "x-subscription-token": options.apiKey,
      },
      signal: boundedSignal(options.signal, 12000),
    },
  );
  if (!response.ok) throw new Error(`Brave returned ${response.status}`);
  const data = (await response.json()) as {
    web?: {
      results?: Array<{
        title: string;
        url: string;
        description: string;
        age?: string;
      }>;
    };
  };
  return (data.web?.results ?? []).map((result) => ({
    title: result.title,
    url: result.url,
    snippet: result.description,
    publishedAt: result.age ?? null,
    sourceId: "",
  }));
}
