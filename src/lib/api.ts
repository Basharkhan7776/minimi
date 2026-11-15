import type {
  BootstrapData,
  ChatUIMessage,
  EmbeddingStatus,
  MemoryRecord,
  MemoryStats,
  PublicProvider,
  Session,
  SessionDetail,
} from "./types";

function resolveApiBase(): string {
  if (typeof window === "undefined") return "";
  if (import.meta.env.DEV) return "";
  const { protocol, hostname, port } = window.location;
  if (protocol === "tauri:" || hostname === "tauri.localhost") {
    return "http://127.0.0.1:8787";
  }
  if (port === "8787") return "";
  return "http://127.0.0.1:8787";
}

export const API_BASE = resolveApiBase();

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(isForm ? {} : { "content-type": "application/json" }),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }
  return data as T;
}

export const api = {
  bootstrap: () => request<BootstrapData>("/api/bootstrap"),

  listSessions: (query?: string) =>
    request<{ sessions: Session[] }>(
      `/api/sessions${query ? `?q=${encodeURIComponent(query)}` : ""}`,
    ),

  createSession: (input?: {
    title?: string;
    providerId?: string | null;
    model?: string | null;
  }) =>
    request<{ session: Session }>("/api/sessions", {
      method: "POST",
      body: JSON.stringify(input ?? {}),
    }),

  getSession: (id: string) =>
    request<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`),

  updateSession: (
    id: string,
    patch: Partial<{
      title: string;
      pinned: boolean;
      archived: boolean;
      providerId: string | null;
      model: string | null;
    }>,
  ) =>
    request<{ session: Session }>(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  deleteSession: (id: string) =>
    request<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  uploadFile: (file: File, sessionId?: string | null) => {
    const form = new FormData();
    form.append("file", file);
    if (sessionId) form.append("sessionId", sessionId);
    return request<{
      file: { id: string; name: string; mime: string; size: number; hasText: boolean };
    }>("/api/files", { method: "POST", body: form });
  },

  deleteFile: (id: string) =>
    request<{ ok: boolean }>(`/api/files/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  listProviders: () =>
    request<{ providers: PublicProvider[] }>("/api/providers"),

  updateProvider: (
    id: string,
    patch: Partial<{
      name: string;
      baseUrl: string | null;
      apiKey: string;
      defaultModel: string | null;
      enabled: boolean;
      sortOrder: number;
    }>,
  ) =>
    request<{ provider: PublicProvider }>(
      `/api/providers/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    ),

  createProvider: (input: {
    id?: string;
    name: string;
    baseUrl: string;
    apiKey?: string;
    defaultModel: string;
  }) =>
    request<{ provider: PublicProvider }>("/api/providers", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  deleteProvider: (id: string) =>
    request<{ ok: boolean }>(`/api/providers/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  testProvider: (id: string, model?: string) =>
    request<{
      ok: boolean;
      ms: number;
      model?: string;
      reply?: string;
      error?: string;
    }>(`/api/providers/${encodeURIComponent(id)}/test`, {
      method: "POST",
      body: JSON.stringify({ model }),
    }),

  getSettings: () =>
    request<{ settings: Record<string, string> }>("/api/settings"),

  updateSettings: (patch: Record<string, string | number | boolean>) =>
    request<{ settings: Record<string, string> }>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  getMemory: () =>
    request<{
      stats: MemoryStats;
      embedding: EmbeddingStatus;
      memories: MemoryRecord[];
    }>("/api/memory"),

  clearMemory: () =>
    request<{ ok: boolean; stats: MemoryStats }>("/api/memory", {
      method: "DELETE",
    }),

  rebuildMemory: () =>
    request<{ ok: boolean; count: number; stats: MemoryStats }>(
      "/api/memory/rebuild",
      { method: "POST" },
    ),

  exportData: async (): Promise<Blob> => {
    const response = await fetch(`${API_BASE}/api/export`);
    if (!response.ok) throw new ApiError("Export failed", response.status);
    return response.blob();
  },

  importData: (data: unknown) =>
    request<{
      ok: boolean;
      importedSessions: number;
      importedMessages: number;
      importedMemories?: number;
    }>("/api/import", { method: "POST", body: JSON.stringify(data) }),

  clearData: () =>
    request<{ ok: boolean }>("/api/data/clear", { method: "POST" }),
};

export type { ChatUIMessage };
