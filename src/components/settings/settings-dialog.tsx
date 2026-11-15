"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";
import {
  CheckCircle2Icon,
  DatabaseIcon,
  DownloadIcon,
  HardDriveIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UploadIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ProviderBadge } from "@/components/provider-badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { api } from "@/lib/api";
import { formatDate, formatRelative } from "@/lib/format";
import type {
  EmbeddingStatus,
  MemoryRecord,
  MemoryStats,
  PublicProvider,
} from "@/lib/types";

const PROVIDER_HELP: Record<string, string> = {
  openai: "Official OpenAI models. Requires an API key.",
  anthropic: "Claude models with extended reasoning. Requires an API key.",
  google: "Gemini models through the Google Generative AI API.",
  openrouter: "One key for many hosted models, including open models.",
  ollama: "Local models served by Ollama. No API key needed.",
  custom: "Any OpenAI-compatible endpoint (LM Studio, vLLM, etc.).",
};

const PROVIDER_BASE_HINT: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: "https://generativelanguage.googleapis.com/v1beta",
  openrouter: "https://openrouter.ai/api/v1",
  ollama: "http://127.0.0.1:11434/v1",
  custom: "http://127.0.0.1:1234/v1",
};

interface MemoryPayload {
  stats: MemoryStats;
  embedding: EmbeddingStatus;
  memories: MemoryRecord[];
}

export function SettingsDialog({
  open,
  onOpenChange,
  onChanged,
  initialTab = "providers",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  initialTab?: string;
}) {
  const [providers, setProviders] = useState<PublicProvider[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [memory, setMemory] = useState<MemoryPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [clearMemoryOpen, setClearMemoryOpen] = useState(false);
  const [clearDataOpen, setClearDataOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<unknown>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [providerResult, settingsResult, memoryResult] = await Promise.all([
        api.listProviders(),
        api.getSettings(),
        api.getMemory(),
      ]);
      setProviders(providerResult.providers);
      setSettings(settingsResult.settings);
      setMemory(memoryResult);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not load settings.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void load();
  }, [open]);

  async function saveSetting(key: string, value: string | number | boolean) {
    try {
      const result = await api.updateSettings({ [key]: value });
      setSettings(result.settings);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save setting.",
      );
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      const blob = await api.exportData();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `minimi-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  async function handleImportFile(file: File) {
    try {
      const text = await file.text();
      setPendingImport(JSON.parse(text));
    } catch {
      toast.error("That file is not valid JSON.");
    }
  }

  async function confirmImport() {
    if (!pendingImport) return;
    setImporting(true);
    try {
      const result = await api.importData(pendingImport);
      toast.success(
        `Imported ${result.importedSessions} conversations, ${result.importedMessages} messages and ${result.importedMemories ?? 0} memories.`,
      );
      setPendingImport(null);
      await load();
      onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setImporting(false);
    }
  }

  async function clearMemory() {
    try {
      const result = await api.clearMemory();
      setMemory((current) =>
        current ? { ...current, stats: result.stats, memories: [] } : current,
      );
      toast.success("Memory cleared.");
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not clear memory.",
      );
    }
  }

  async function rebuildMemory() {
    setRebuilding(true);
    try {
      const result = await api.rebuildMemory();
      toast.success(
        `Rebuilt ${result.count} memories from ${result.stats.messages} messages.`,
      );
      await load();
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not rebuild memory.",
      );
    } finally {
      setRebuilding(false);
    }
  }

  async function clearData() {
    try {
      await api.clearData();
      toast.success("All local data cleared.");
      onChanged();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not clear data.",
      );
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogPopup className="max-h-[88vh] w-full max-w-2xl">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Providers, memory and local data. Everything stays on this
              machine.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="min-h-0 p-0">
            <Tabs defaultValue={initialTab} className="min-h-0">
              <div className="border-b px-6 pb-2">
                <TabsList>
                  <TabsTab value="providers">Providers</TabsTab>
                  <TabsTab value="memory">Memory</TabsTab>
                  <TabsTab value="general">General</TabsTab>
                  <TabsTab value="data">Data</TabsTab>
                </TabsList>
              </div>

              <TabsPanel value="providers" className="space-y-3 px-6 pb-6">
                {loading && providers.length === 0 ? (
                  <div className="py-10 text-center text-muted-foreground text-sm">
                    Loading providers…
                  </div>
                ) : (
                  providers.map((provider) => (
                    <ProviderCard
                      key={provider.id}
                      provider={provider}
                      onSaved={() => {
                        void load();
                        onChanged();
                      }}
                    />
                  ))
                )}

                <div className="rounded-xl border border-dashed p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-sm">
                        Add OpenAI-compatible provider
                      </div>
                      <p className="text-muted-foreground text-xs">
                        Point Minimi at LM Studio, vLLM, or another local
                        gateway.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAdding((value) => !value)}
                    >
                      <PlusIcon />
                      {adding ? "Close" : "Add"}
                    </Button>
                  </div>
                  {adding && (
                    <AddProviderForm
                      onCreated={() => {
                        setAdding(false);
                        void load();
                        onChanged();
                      }}
                    />
                  )}
                </div>
              </TabsPanel>

              <TabsPanel value="memory" className="space-y-4 px-6 pb-6">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Stat
                    label="Memories"
                    value={memory?.stats.memories ?? 0}
                  />
                  <Stat
                    label="Messages"
                    value={memory?.stats.messages ?? 0}
                  />
                  <Stat
                    label="Embedding"
                    value={memory?.embedding.state ?? "loading"}
                  />
                  <Stat
                    label="Dimensions"
                    value={memory?.embedding.dimension ?? 384}
                  />
                </div>

                <div className="rounded-xl border p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium text-sm">
                        Long-term memory
                      </div>
                      <p className="text-muted-foreground text-xs">
                        Extract durable facts and preferences from chats and
                        recall them with hybrid vector + keyword search.
                      </p>
                    </div>
                    <Switch
                      checked={settings["memory.enabled"] !== "0"}
                      onCheckedChange={(checked) =>
                        void saveSetting("memory.enabled", checked ? "1" : "0")
                      }
                    />
                  </div>
                  <div className="mt-3 flex items-start justify-between gap-4 border-t pt-3">
                    <div>
                      <div className="font-medium text-sm">
                        Extract automatically
                      </div>
                      <p className="text-muted-foreground text-xs">
                        Runs a small extraction pass after each assistant reply.
                      </p>
                    </div>
                    <Switch
                      checked={settings["memory.autoExtract"] !== "0"}
                      onCheckedChange={(checked) =>
                        void saveSetting(
                          "memory.autoExtract",
                          checked ? "1" : "0",
                        )
                      }
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={rebuilding}
                      onClick={() => void rebuildMemory()}
                    >
                      <RefreshCwIcon
                        className={rebuilding ? "animate-spin" : undefined}
                      />
                      Rebuild from history
                    </Button>
                    <Button
                      variant="destructive-outline"
                      size="sm"
                      onClick={() => setClearMemoryOpen(true)}
                    >
                      <Trash2Icon />
                      Clear memory
                    </Button>
                    <span className="text-muted-foreground text-xs">
                      {memory?.embedding.model ?? "bge-small-en-v1.5"}
                    </span>
                  </div>
                </div>

                <div>
                  <div className="mb-2 font-medium text-muted-foreground text-xs">
                    Recent memories
                  </div>
                  <div className="space-y-1.5">
                    {(memory?.memories ?? []).slice(0, 10).map((record) => (
                      <div
                        key={record.id}
                        className="rounded-lg border bg-card p-2.5"
                      >
                        <div className="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span className="rounded-full bg-muted px-1.5 py-0.5">
                            {record.kind}
                          </span>
                          {record.eventDate
                            ? formatDate(record.eventDate)
                            : formatRelative(record.createdAt)}
                        </div>
                        <div className="line-clamp-2 text-sm leading-relaxed">
                          {record.text}
                        </div>
                      </div>
                    ))}
                    {(!memory?.memories || memory.memories.length === 0) && (
                      <div className="rounded-lg border border-dashed py-8 text-center text-muted-foreground text-xs">
                        No memories yet. Chat normally and Minimi will start
                        remembering what matters.
                      </div>
                    )}
                  </div>
                </div>
              </TabsPanel>

              <TabsPanel value="general" className="space-y-4 px-6 pb-6">
                <ThemeSetting
                  value={settings["app.theme"] ?? "system"}
                  onChange={(value) => {
                    setSettings((current) => ({
                      ...current,
                      "app.theme": value,
                    }));
                    void saveSetting("app.theme", value);
                  }}
                />

                <div className="rounded-xl border p-4">
                  <div className="font-medium text-sm">Web search</div>
                  <p className="mb-3 text-muted-foreground text-xs">
                    DuckDuckGo works without a key. Tavily and Brave use
                    BRAVE_API_KEY / TAVILY_API_KEY from the server environment.
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Provider</Label>
                      <Select
                        value={settings["search.provider"] ?? "duckduckgo"}
                        onValueChange={(value) =>
                          void saveSetting("search.provider", String(value))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectPopup>
                          <SelectItem value="duckduckgo">DuckDuckGo</SelectItem>
                          <SelectItem value="tavily">Tavily</SelectItem>
                          <SelectItem value="brave">Brave Search</SelectItem>
                        </SelectPopup>
                      </Select>
                    </div>
                    <NumberSetting
                      label="Results per search"
                      value={settings["search.maxResults"] ?? "5"}
                      min={1}
                      max={10}
                      onCommit={(value) =>
                        void saveSetting("search.maxResults", value)
                      }
                    />
                  </div>
                </div>

                <div className="rounded-xl border p-4">
                  <div className="font-medium text-sm">Agent behaviour</div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <NumberSetting
                      label="Maximum tool steps"
                      value={settings["chat.maxSteps"] ?? "8"}
                      min={1}
                      max={20}
                      onCommit={(value) =>
                        void saveSetting("chat.maxSteps", value)
                      }
                    />
                    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                      <div>
                        <div className="font-medium text-sm">Auto title</div>
                        <p className="text-muted-foreground text-xs">
                          Name chats from the first message.
                        </p>
                      </div>
                      <Switch
                        checked={settings["chat.autoTitle"] !== "0"}
                        onCheckedChange={(checked) =>
                          void saveSetting(
                            "chat.autoTitle",
                            checked ? "1" : "0",
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              </TabsPanel>

              <TabsPanel value="data" className="space-y-3 px-6 pb-6">
                <div className="rounded-xl border p-4">
                  <div className="flex items-start gap-3">
                    <DatabaseIcon className="mt-0.5 size-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm">Export</div>
                      <p className="text-muted-foreground text-xs">
                        Download conversations, messages, memories, and provider
                        metadata as JSON. API keys are never included.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={exporting}
                      onClick={() => void handleExport()}
                    >
                      <DownloadIcon />
                      Export
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border p-4">
                  <div className="flex items-start gap-3">
                    <UploadIcon className="mt-0.5 size-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm">Import</div>
                      <p className="text-muted-foreground text-xs">
                        Merge a previous Minimi export. Existing IDs are skipped.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={importing}
                      onClick={() => importRef.current?.click()}
                    >
                      <UploadIcon />
                      Import
                    </Button>
                    <input
                      ref={importRef}
                      type="file"
                      accept="application/json,.json"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void handleImportFile(file);
                      }}
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-destructive/30 p-4">
                  <div className="flex items-start gap-3">
                    <HardDriveIcon className="mt-0.5 size-4 text-destructive" />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm">Clear local data</div>
                      <p className="text-muted-foreground text-xs">
                        Delete every conversation, message, memory, and uploaded
                        file from this machine.
                      </p>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => setClearDataOpen(true)}
                    >
                      <Trash2Icon />
                      Clear
                    </Button>
                  </div>
                </div>

                <p className="text-muted-foreground text-[11px]">
                  Data is stored in the local SQLite database managed by the
                  Minimi server. No telemetry is sent anywhere.
                </p>
              </TabsPanel>
            </Tabs>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <ConfirmDialog
        open={clearMemoryOpen}
        onOpenChange={setClearMemoryOpen}
        title="Clear all memories?"
        description="Extracted facts and preferences will be deleted. Conversations stay intact."
        confirmLabel="Clear memory"
        destructive
        onConfirm={() => void clearMemory()}
      />
      <ConfirmDialog
        open={clearDataOpen}
        onOpenChange={setClearDataOpen}
        title="Delete all local data?"
        description="This permanently removes every conversation, message, memory, and uploaded file. Export first if you want a backup."
        confirmLabel="Delete everything"
        destructive
        onConfirm={() => void clearData()}
      />
      <ConfirmDialog
        open={pendingImport !== null}
        onOpenChange={(value) => {
          if (!value) setPendingImport(null);
        }}
        title="Import this export?"
        description="Conversations and messages are merged into your local database. Existing IDs are skipped."
        confirmLabel={importing ? "Importing…" : "Import"}
        onConfirm={() => void confirmImport()}
      />
    </>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="font-medium text-[11px] text-muted-foreground uppercase tracking-wide">
        {label}
      </div>
      <div className="mt-0.5 truncate font-semibold text-lg tabular-nums">
        {value}
      </div>
    </div>
  );
}

function NumberSetting({
  label,
  value,
  min,
  max,
  onCommit,
}: {
  label: string;
  value: string;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  function commit() {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(value);
      return;
    }
    const clamped = Math.min(max, Math.max(min, Math.round(parsed)));
    setDraft(String(clamped));
    if (String(clamped) !== value) onCommit(clamped);
  }
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

function ThemeSetting({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { setTheme } = useTheme();
  return (
    <div className="rounded-xl border p-4">
      <div className="font-medium text-sm">Appearance</div>
      <p className="mb-3 text-muted-foreground text-xs">
        Choose how Minimi looks on this device.
      </p>
      <div className="flex gap-2">
        {(["system", "light", "dark"] as const).map((theme) => (
          <Button
            key={theme}
            size="sm"
            variant={value === theme ? "default" : "outline"}
            onClick={() => {
              setTheme(theme);
              onChange(theme);
            }}
            className="capitalize"
          >
            {theme}
          </Button>
        ))}
      </div>
    </div>
  );
}

function ProviderCard({
  provider,
  onSaved,
}: {
  provider: PublicProvider;
  onSaved: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(
    provider.baseUrl ?? PROVIDER_BASE_HINT[provider.type] ?? "",
  );
  const [model, setModel] = useState(provider.defaultModel ?? "");
  const [enabled, setEnabled] = useState(provider.enabled);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(
    null,
  );

  async function save(nextEnabled = enabled) {
    setSaving(true);
    try {
      await api.updateProvider(provider.id, {
        enabled: nextEnabled,
        baseUrl: baseUrl.trim() || null,
        defaultModel: model.trim() || null,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      setApiKey("");
      setResult(null);
      toast.success(`${provider.name} saved.`);
      onSaved();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save provider.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      const response = await api.testProvider(provider.id, model.trim() || undefined);
      setResult({
        ok: response.ok,
        message: response.ok
          ? `Connected in ${response.ms}ms · ${response.model ?? ""}`
          : response.error ?? "Connection failed",
      });
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : "Connection failed",
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <ProviderBadge provider={provider} size={34} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-sm">{provider.name}</span>
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {provider.type}
            </span>
            {provider.hasApiKey && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                <CheckCircle2Icon className="size-2.5" />
                key saved
              </span>
            )}
          </div>
          <p className="mt-0.5 text-muted-foreground text-xs">
            {PROVIDER_HELP[provider.type]}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => {
            setEnabled(checked);
            void save(checked);
          }}
        />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>API key</Label>
          <Input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              provider.apiKeyPreview
                ? `Saved ${provider.apiKeyPreview}`
                : provider.type === "ollama"
                  ? "Not required for Ollama"
                  : "Paste API key"
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label>Default model</Label>
          <Input
            value={model}
            onChange={(event) => setModel(event.target.value)}
            placeholder="Model id"
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Base URL</Label>
          <Input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={PROVIDER_BASE_HINT[provider.type]}
          />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={testing || saving}
          onClick={() => void test()}
        >
          {testing ? "Testing…" : "Test connection"}
        </Button>
        {result && (
          <span
            className={
              result.ok
                ? "text-emerald-600 text-xs dark:text-emerald-400"
                : "text-destructive text-xs"
            }
          >
            {result.ok ? (
              <CheckCircle2Icon className="me-1 inline size-3" />
            ) : (
              <TriangleAlertIcon className="me-1 inline size-3" />
            )}
            {result.message}
          </span>
        )}
      </div>
    </div>
  );
}

function AddProviderForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:1234/v1");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  async function create() {
    if (!name.trim() || !baseUrl.trim() || !model.trim()) {
      toast.error("Name, base URL and default model are required.");
      return;
    }
    setSaving(true);
    try {
      await api.createProvider({
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        defaultModel: model.trim(),
        apiKey: apiKey.trim() || undefined,
      });
      toast.success("Provider added.");
      onCreated();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not add provider.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 grid gap-2 border-t pt-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label>Name</Label>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="LM Studio"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Default model</Label>
        <Input
          value={model}
          onChange={(event) => setModel(event.target.value)}
          placeholder="local-model"
        />
      </div>
      <div className="space-y-1.5">
        <Label>Base URL</Label>
        <Input
          value={baseUrl}
          onChange={(event) => setBaseUrl(event.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label>API key (optional)</Label>
        <Input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="Optional"
        />
      </div>
      <div className="sm:col-span-2">
        <Button size="sm" disabled={saving} onClick={() => void create()}>
          <PlusIcon />
          Add provider
        </Button>
      </div>
    </div>
  );
}
