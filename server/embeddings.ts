import path from "node:path";
import { DATA_DIR, EMBEDDING_DIM } from "./config";

type Embedder = {
  queryEmbed: (query: string) => Promise<number[]>;
  passageEmbed: (
    texts: string[],
    batchSize: number,
  ) => AsyncGenerator<number[][]>;
};

export interface EmbeddingStatus {
  state: "idle" | "loading" | "ready" | "error";
  model: string;
  dimension: number;
  error?: string;
}

let embedder: Embedder | null = null;
let loading: Promise<Embedder> | null = null;
let status: EmbeddingStatus = {
  state: "idle",
  model: "bge-small-en-v1.5",
  dimension: EMBEDDING_DIM,
};

export function getEmbeddingStatus(): EmbeddingStatus {
  return { ...status };
}

async function loadEmbedder(): Promise<Embedder> {
  if (embedder) return embedder;
  if (loading) return loading;

  status = { ...status, state: "loading", error: undefined };
  loading = (async () => {
    try {
      const { FlagEmbedding, EmbeddingModel } = await import("fastembed");
      const instance = await FlagEmbedding.init({
        model: EmbeddingModel.BGESmallENV15,
        cacheDir: path.join(DATA_DIR, "models"),
        showDownloadProgress: false,
      });
      embedder = instance as unknown as Embedder;
      status = { ...status, state: "ready" };
      return embedder;
    } catch (error) {
      status = {
        ...status,
        state: "error",
        error: error instanceof Error ? error.message : String(error),
      };
      throw error;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export async function embedQuery(text: string): Promise<number[]> {
  const instance = await loadEmbedder();
  return instance.queryEmbed(text.slice(0, 4000));
}

export async function embedPassages(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const instance = await loadEmbedder();
  const results: number[][] = [];
  for await (const batch of instance.passageEmbed(
    texts.map((text) => text.slice(0, 4000)),
    8,
  )) {
    results.push(...batch);
  }
  return results;
}

export async function warmEmbeddings(): Promise<void> {
  try {
    await loadEmbedder();
  } catch (error) {
    console.error("[embeddings] warmup failed", error);
  }
}
