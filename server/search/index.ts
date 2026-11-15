import { createHash } from "node:crypto";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import { getDb, getSetting } from "../db";
import type { SearchResult } from "../db/types";
import { enrichResults } from "./extract";
import {
  braveSearch,
  duckDuckGoSearch,
  tavilySearch,
  type Freshness,
} from "./ddg";

interface CachedSearch {
  query: string;
  results: SearchResult[];
  fetchedAt: number;
}

function hashKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readCache(key: string, ttlMinutes: number): SearchResult[] | null {
  const row = getDb()
    .prepare("SELECT results_json, fetched_at FROM search_cache WHERE query_hash = ?")
    .get(key) as { results_json: string; fetched_at: number } | undefined;
  if (!row) return null;
  if (Date.now() - row.fetched_at > ttlMinutes * 60_000) return null;
  try {
    return JSON.parse(row.results_json) as SearchResult[];
  } catch {
    return null;
  }
}

function writeCache(key: string, query: string, results: SearchResult[]): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO search_cache (query_hash, query, results_json, fetched_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(key, query, JSON.stringify(results), Date.now());
}

export interface WebSearchResponse {
  queries: string[];
  results: SearchResult[];
  provider: string;
  cached: boolean;
  errors: string[];
}

export async function webSearch(options: {
  query: string;
  freshness?: Freshness;
  context?: string;
  maxResults?: number;
  model?: LanguageModel;
  signal?: AbortSignal;
}): Promise<WebSearchResponse> {
  const maxResults = options.maxResults ?? Number(getSetting("search.maxResults") ?? 5);
  const ttl = Number(getSetting("search.cacheTtlMinutes") ?? 180);
  const provider = resolveProvider();
  const cacheKey = hashKey(
    `${provider.name}|${options.freshness ?? "any"}|${maxResults}|${options.query.toLowerCase().trim()}`,
  );
  const cached = readCache(cacheKey, ttl);
  if (cached) {
    return {
      queries: [options.query],
      results: cached,
      provider: provider.name,
      cached: true,
      errors: [],
    };
  }

  const queries = await expandQueries({
    query: options.query,
    context: options.context,
    model: options.model,
  }).catch(() => [options.query]);

  const errors: string[] = [];
  const found = new Map<string, SearchResult>();
  const perQuery = Math.max(3, Math.ceil(maxResults / Math.max(1, queries.length)) + 1);

  await Promise.all(
    queries.map(async (query) => {
      try {
        const results = await provider.search({
          query,
          maxResults: perQuery,
          freshness: options.freshness,
          signal: options.signal,
        });
        for (const result of results) {
          const key = result.url.replace(/[#?].*$/, "");
          if (!found.has(key)) found.set(key, result);
        }
      } catch (error) {
        errors.push(
          `${query}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );

  let results = [...found.values()].slice(0, maxResults);
  if (results.length > 0) {
    results = await enrichResults(results, {
      maxPages: Math.min(3, results.length),
      signal: options.signal,
    });
  }
  results = results.map((result, index) => ({
    ...result,
    sourceId: `S${index + 1}`,
  }));

  if (results.length > 0) writeCache(cacheKey, options.query, results);

  return {
    queries,
    results,
    provider: provider.name,
    cached: false,
    errors,
  };
}

function resolveProvider(): {
  name: string;
  search: (options: {
    query: string;
    maxResults?: number;
    freshness?: Freshness;
    signal?: AbortSignal;
  }) => Promise<SearchResult[]>;
} {
  const configured = getSetting("search.provider") ?? "duckduckgo";
  const braveKey = process.env.BRAVE_API_KEY;
  const tavilyKey = process.env.TAVILY_API_KEY;

  if (configured === "brave" && braveKey) {
    return {
      name: "brave",
      search: (options) =>
        braveSearch({ ...options, apiKey: braveKey }),
    };
  }
  if (configured === "tavily" && tavilyKey) {
    return {
      name: "tavily",
      search: (options) =>
        tavilySearch({ ...options, apiKey: tavilyKey }),
    };
  }
  return {
    name: "duckduckgo",
    search: (options) => duckDuckGoSearch(options),
  };
}

const expandSchema = z.object({
  queries: z
    .array(z.string())
    .min(1)
    .max(3)
    .describe("Search-engine queries, most important first."),
});

export async function expandQueries(options: {
  query: string;
  context?: string;
  model?: LanguageModel;
}): Promise<string[]> {
  if (!options.model) return [options.query];
  if (options.query.length < 18 && !/\b(since|last|change|compare|today)\b/i.test(options.query)) {
    return [options.query];
  }

  try {
    const { object } = await generateObject({
      model: options.model,
      schema: expandSchema,
      temperature: 0,
      abortSignal: AbortSignal.timeout(6000),
      system:
        "You turn a user's information need into 1-3 high-signal web search queries. Resolve pronouns and vague references using the conversation context. Include concrete entity names, product names, dates, and the word 'pricing' or 'changelog' when the user is asking about changes. Never answer the question. Never add commentary. If one query is enough, return one.",
      prompt: `Today is ${new Date().toISOString().slice(0, 10)}.\n\nConversation context:\n${(options.context ?? "").slice(-4000)}\n\nUser information need:\n${options.query}\n\nReturn 1-3 search queries.`,
    });
    const queries = object.queries
      .map((query) => query.trim())
      .filter(Boolean)
      .slice(0, 3);
    return queries.length > 0 ? queries : [options.query];
  } catch {
    return [options.query];
  }
}
