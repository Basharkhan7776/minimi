"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/lib/theme";
import {
  BarChart2Icon,
  BellIcon,
  CheckCircle2Icon,
  ClockIcon,
  DatabaseIcon,
  DownloadIcon,
  LaptopIcon,
  MoonIcon,
  PaletteIcon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  ShieldIcon,
  SlidersHorizontalIcon,
  SlidersIcon,
  SunIcon,
  TerminalIcon,
  TriangleAlertIcon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogClose,
  DialogPopup,
} from "@/components/ui/dialog";
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
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionPanel,
} from "@/components/ui/accordion";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { api } from "@/lib/api";
import {
  ensureNotificationPermission,
  showSystemNotification,
} from "@/lib/notifications";
import { cn } from "@/lib/utils";
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

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  keywords: string;
}

const SETTINGS_TABS: NavItem[] = [
  {
    id: "appearance",
    label: "Appearance",
    icon: PaletteIcon,
    keywords: "appearance theme dark light system colors display style",
  },
  {
    id: "behavior",
    label: "Behavior",
    icon: SlidersHorizontalIcon,
    keywords: "behavior agent tool steps auto title thinking execution prompt reasoning",
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: BellIcon,
    keywords: "notifications alerts reminders nudges system sounds permissions",
  },
  {
    id: "provider",
    label: "Provider",
    icon: SlidersIcon,
    keywords: "provider providers models openai anthropic google gemini openrouter ollama api keys",
  },
  {
    id: "connect-apps",
    label: "Connect Apps",
    icon: PlugIcon,
    keywords: "connect apps integrations web search duckduckgo brave tavily engine internet",
  },
  {
    id: "skills",
    label: "Skills",
    icon: TerminalIcon,
    keywords: "skills tools web_search fetch_url recall_memory create_reminder capabilities",
  },
  {
    id: "automations",
    label: "Automations",
    icon: ClockIcon,
    keywords: "automations reminders scheduler cron engine background tick second brain",
  },
  {
    id: "data-controls",
    label: "Data Controls",
    icon: ShieldIcon,
    keywords: "data controls export import backup clear delete sqlite privacy local reset",
  },
  {
    id: "usage",
    label: "Usage",
    icon: BarChart2Icon,
    keywords: "usage metrics stats messages sessions memories embeddings dimension storage",
  },
];

function normalizeTab(tab?: string): string {
  if (!tab) return "appearance";
  const lower = tab.toLowerCase();
  if (lower === "account") return "appearance";
  if (lower === "providers" || lower === "provider" || lower === "customize") return "provider";
  if (lower === "memory") return "usage";
  if (lower === "general") return "behavior";
  if (lower === "data") return "data-controls";
  return lower;
}

export function SettingsDialog({
  open,
  onOpenChange,
  onChanged,
  initialTab = "appearance",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  initialTab?: string;
}) {
  const [activeTab, setActiveTab] = useState(() => normalizeTab(initialTab));
  const [searchQuery, setSearchQuery] = useState("");
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

  useEffect(() => {
    setActiveTab(normalizeTab(initialTab));
  }, [initialTab]);

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
      onChanged();
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
        `Imported ${result.importedSessions} conversations, ${result.importedMessages} messages, ${result.importedMemories ?? 0} memories and ${result.importedReminders ?? 0} reminders.`,
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
      await api.clearMemory();
      toast.success("Memories cleared.");
      await load();
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

  const filteredTabs = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return SETTINGS_TABS;
    return SETTINGS_TABS.filter(
      (tab) => tab.label.toLowerCase().includes(q) || tab.keywords.includes(q),
    );
  }, [searchQuery]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogPopup
          showCloseButton={false}
          className="flex h-[660px] max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white p-0 text-foreground shadow-2xl md:flex-row dark:border-white/[0.08] dark:bg-[#161618]"
        >
          {/* Left Sidebar */}
          <div className="flex w-full shrink-0 flex-col border-b border-neutral-200 bg-neutral-50/80 p-3 md:w-60 md:border-r md:border-b-0 dark:border-white/[0.06] dark:bg-[#111113]">
            {/* Search Input */}
            <div className="relative mb-2">
              <SearchIcon className="pointer-events-none absolute start-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/70" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search"
                className="h-8 w-full rounded-lg border border-neutral-200 bg-white ps-8 pe-3 text-xs text-foreground placeholder:text-muted-foreground outline-none transition-colors focus:border-neutral-400 dark:border-white/[0.08] dark:bg-white/[0.04] dark:focus:border-white/[0.2] dark:focus:bg-white/[0.07]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground/70 hover:text-foreground"
                >
                  <XIcon className="size-3" />
                </button>
              )}
            </div>

            {/* Navigation List */}
            <div className="flex flex-1 flex-row gap-0.5 overflow-x-auto overflow-y-auto pb-1 md:flex-col md:pb-0">
              {filteredTabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors md:text-[13px]",
                      isActive
                        ? "bg-neutral-200 text-neutral-900 shadow-xs dark:bg-[#25252a] dark:text-white"
                        : "text-neutral-600 hover:bg-neutral-200/60 hover:text-neutral-900 dark:text-[#8e8e96] dark:hover:bg-white/[0.04] dark:hover:text-[#d4d4d8]",
                    )}
                  >
                    <Icon
                      className={cn(
                        "size-4 shrink-0",
                        isActive
                          ? "text-neutral-900 dark:text-white"
                          : "text-neutral-500 dark:text-[#8e8e96]",
                      )}
                    />
                    <span className="truncate">{tab.label}</span>
                  </button>
                );
              })}

              {filteredTabs.length === 0 && (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  No matching settings
                </div>
              )}
            </div>
          </div>

          {/* Right Main Content */}
          <div className="relative flex flex-1 flex-col min-w-0 bg-white dark:bg-[#17171a] overflow-hidden">
            {/* Top Close Button */}
            <DialogClose
              aria-label="Close"
              className="absolute end-4 top-4 z-20 text-neutral-400 hover:text-neutral-900 dark:text-[#8e8e96] dark:hover:text-white"
              render={
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 rounded-lg hover:bg-neutral-100 dark:hover:bg-white/[0.08]"
                />
              }
            >
              <XIcon className="size-4" />
            </DialogClose>

            {/* Scrollable Tab Content */}
            <div className="flex-1 overflow-y-auto p-6 md:p-7">
              {/* TAB: APPEARANCE */}
              {activeTab === "appearance" && (
                <div className="space-y-6">
                  <h2 className="text-xl font-semibold text-neutral-900 dark:text-white tracking-tight">
                    Appearance
                  </h2>

                  <div>
                    <div className="mb-2 text-xs font-medium text-neutral-500 dark:text-[#8e8e96]">
                      Theme
                    </div>
                    <ThemeSetting
                      value={settings["app.theme"] ?? "system"}
                      onChange={(value) => {
                        setSettings((cur) => ({ ...cur, "app.theme": value }));
                        void saveSetting("app.theme", value);
                      }}
                    />
                  </div>
                </div>
              )}

              {/* TAB: BEHAVIOR */}
              {activeTab === "behavior" && (
                <div className="space-y-6">
                  <h2 className="text-xl font-semibold text-neutral-900 dark:text-white tracking-tight">
                    Behavior
                  </h2>

                  <div>
                    <div className="mb-2 text-xs font-medium text-neutral-500 dark:text-[#8e8e96]">
                      Agent Execution
                    </div>
                    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50/50 divide-y divide-neutral-200 dark:border-white/[0.08] dark:bg-[#1e1e22]/90 dark:divide-white/[0.06]">
                      <div className="p-4 flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-medium text-neutral-900 dark:text-white">
                            Maximum tool steps
                          </div>
                          <p className="text-xs text-neutral-500 dark:text-[#8e8e96]">
                            Upper bound on sequential tool calls (search, read,
                            memory, reminder) per turn.
                          </p>
                        </div>
                        <NumberSetting
                          value={settings["chat.maxSteps"] ?? "8"}
                          min={1}
                          max={20}
                          onCommit={(v) => void saveSetting("chat.maxSteps", v)}
                        />
                      </div>

                      <div className="p-4 flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-medium text-neutral-900 dark:text-white">
                            Automatic chat titling
                          </div>
                          <p className="text-xs text-neutral-500 dark:text-[#8e8e96]">
                            Summarize conversation titles automatically in the
                            background.
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

                      <div className="p-4 flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-medium text-neutral-900 dark:text-white">
                            Automatic memory extraction
                          </div>
                          <p className="text-xs text-neutral-500 dark:text-[#8e8e96]">
                            Extract facts, preferences, and commitments after
                            each turn.
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
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: NOTIFICATIONS */}
              {activeTab === "notifications" && (
                <div className="space-y-6">
                  <h2 className="text-xl font-semibold text-neutral-900 dark:text-white tracking-tight">
                    Notifications
                  </h2>

                  <div>
                    <div className="mb-2 text-xs font-medium text-neutral-500 dark:text-[#8e8e96]">
                      Alerts & Reminders
                    </div>
                    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50/50 divide-y divide-neutral-200 dark:border-white/[0.08] dark:bg-[#1e1e22]/90 dark:divide-white/[0.06]">
                      <div className="p-4 flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-medium text-neutral-900 dark:text-white">
                            Desktop notifications
                          </div>
                          <p className="text-xs text-neutral-500 dark:text-[#8e8e96]">
                            Trigger system alerts when scheduled reminders become
                            due.
                          </p>
                        </div>
                        <Switch
                          checked={settings["notifications.enabled"] !== "0"}
                          onCheckedChange={async (checked) => {
                            if (checked) {
                              const granted =
                                await ensureNotificationPermission();
                              if (!granted) {
                                toast.error(
                                  "Notifications are blocked in this browser or system.",
                                );
                                return;
                              }
                            }
                            setSettings((cur) => ({
                              ...cur,
                              "notifications.enabled": checked ? "1" : "0",
                            }));
                            void saveSetting(
                              "notifications.enabled",
                              checked ? "1" : "0",
                            );
                          }}
                        />
                      </div>

                      <div className="p-4 flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-medium text-neutral-900 dark:text-white">
                            Test notification
                          </div>
                          <p className="text-xs text-neutral-500 dark:text-[#8e8e96]">
                            Send a test alert to verify notification delivery.
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={async () => {
                            const granted =
                              await ensureNotificationPermission();
                            if (granted) {
                              await showSystemNotification({
                                title: "Minimi Notification",
                                body: "Desktop notifications are working properly!",
                              });
                              toast.success("Test notification sent.");
                            } else {
                              toast.error("Notification permission denied.");
                            }
                          }}
                        >
                          Send Test
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: PROVIDER */}
              {activeTab === "provider" && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-xl font-semibold text-neutral-900 dark:text-white tracking-tight">
                      Provider
                    </h2>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1.5 text-xs"
                      onClick={() => setAdding((val) => !val)}
                    >
                      <PlusIcon className="size-3.5" />
                      Add custom provider
                    </Button>
                  </div>

                  <div>
                    <div className="mb-2 text-xs font-medium text-neutral-500 dark:text-[#8e8e96]">
                      Configured Providers
                    </div>

                    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50/50 dark:border-white/[0.08] dark:bg-[#1e1e22]/90">
                      <Accordion multiple className="w-full">
                        {providers.map((provider) => (
                          <ProviderAccordionItem
                            key={provider.id}
                            provider={provider}
                            onSaved={() => {
                              void load();
                              onChanged();
                            }}
                          />
                        ))}
                      </Accordion>
                    </div>

                    {adding && (
                      <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50/50 p-4 dark:border-white/[0.08] dark:bg-[#1e1e22]/90">
                        <div className="flex items-center justify-between">
                          <h3 className="font-medium text-sm text-neutral-900 dark:text-white">
                            New OpenAI-compatible provider
                          </h3>
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => setAdding(false)}
                          >
                            <XIcon className="size-3.5" />
                          </Button>
                        </div>
                        <AddProviderForm
                          onCreated={() => {
                            setAdding(false);
                            void load();
                            onChanged();
                          }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB: CONNECT APPS (Web Search) */}
              {activeTab === "connect-apps" && (
                <div className="space-y-6">
                  <h2 className="text-xl font-semibold text-neutral-900 dark:text-white tracking-tight">
                    Connect Apps
                  </h2>

                  <div>
                    <div className="mb-2 text-xs font-medium text-neutral-500 dark:text-[#8e8e96]">
                      Search Engines & Live Web
                    </div>
                    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50/50 divide-y divide-neutral-200 dark:border-white/[0.08] dark:bg-[#1e1e22]/90 dark:divide-white/[0.06]">
                      <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-neutral-900 dark:text-white">
                            Search provider
                          </div>
                          <p className="text-xs text-neutral-500 dark:text-[#8e8e96]">
                            DuckDuckGo works with zero keys. Tavily and Brave
                            support optional keys in .env.
                          </p>
                        </div>
                        <Select
                          value={settings["search.provider"] ?? "duckduckgo"}
                          onValueChange={(val) =>
                            void saveSetting("search.provider", String(val))
                          }
                        >
                          <SelectTrigger className="h-8 w-36 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectPopup>
                            <SelectItem value="duckduckgo">
                              DuckDuckGo (Free)
                            </SelectItem>
                            <SelectItem value="tavily">Tavily</SelectItem>
                            <SelectItem value="brave">Brave Search</SelectItem>
                          </SelectPopup>
                        </Select>
                      </div>

                      <div className="p-4 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-neutral-900 dark:text-white">
                            Results per search
                          </div>
                          <p className="text-xs text-neutral-500 dark:text-[#8e8e96]">
                            Number of sources returned per web search query.
                          </p>
                        </div>
                        <NumberSetting
                          value={settings["search.maxResults"] ?? "5"}
                          min={1}
                          max={10}
                          onCommit={(v) =>
                            void saveSetting("search.maxResults", v)
                          }
                        />
                      </div>

                      <div className="p-4 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-neutral-900 dark:text-white">
                            Cache TTL (minutes)
                          </div>
                          <p className="text-xs text-neutral-500 dark:text-[#8e8e96]">
                            How long search responses are cached before refreshing.
                          </p>
                        </div>
                        <NumberSetting
                          value={settings["search.cacheTtlMinutes"] ?? "180"}
                          min={10}
                          max={1440}
                          onCommit={(v) =>
                            void saveSetting("search.cacheTtlMinutes", v)
                          }
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: SKILLS (Agent Capabilities) */}
              {activeTab === "skills" && (
                <div className="space-y-6">
                  <h2 className="text-xl font-semibold text-neutral-900 dark:text-white tracking-tight">
                    Skills
                  </h2>

                  <div>
                    <div className="mb-2 text-xs font-medium text-neutral-500 dark:text-[#8e8e96]">
                      Active Agent Tools
                    </div>
                    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50/50 divide-y divide-neutral-200 dark:border-white/[0.08] dark:bg-[#1e1e22]/90 dark:divide-white/[0.06]">
                      {[
                        {
                          name: "web_search",
                          desc: "Live search with query expansion, page reading, date parsing, and citation generation.",
                          status: "active",
                        },
                        {
                          name: "fetch_url",
                          desc: "Direct URL reader with SSRF blocking and Mozilla Readability content extraction.",
                          status: "active",
                        },
                        {
                          name: "recall_memory",
                          desc: "Hybrid dense-vector (sqlite-vec) and lexical (FTS5) past-conversation retrieval.",
                          status: "active",
                        },
                        {
                          name: "create_reminder",
                          desc: "Natural language schedule parser that creates timed and all-day Second Brain tasks.",
                          status: "active",
                        },
                        {
                          name: "update_reminder",
                          desc: "Modifies, reschedules, or marks active reminders completed from natural language.",
                          status: "active",
                        },
                      ].map((skill) => (
                        <div
                          key={skill.name}
                          className="p-4 flex items-center justify-between gap-4"
                        >
                          <div>
                            <div className="text-sm font-mono font-medium text-neutral-900 dark:text-white">
                              {skill.name}
                            </div>
                            <p className="text-xs text-neutral-500 dark:text-[#8e8e96]">
                              {skill.desc}
                            </p>
                          </div>
                          <span className="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                            Ready
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: AUTOMATIONS (Second Brain Reminders) */}
              {activeTab === "automations" && (
                <div className="space-y-6">
                  <h2 className="text-xl font-semibold text-neutral-900 dark:text-white tracking-tight">
                    Automations
                  </h2>

                  <div>
                    <div className="mb-2 text-xs font-medium text-neutral-500 dark:text-[#8e8e96]">
                      Second Brain Engine
                    </div>
                    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50/50 divide-y divide-neutral-200 dark:border-white/[0.08] dark:bg-[#1e1e22]/90 dark:divide-white/[0.06]">
                      <div className="p-4 flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-medium text-neutral-900 dark:text-white">
                            Scheduler status
                          </div>
                          <p className="text-xs text-neutral-500 dark:text-[#8e8e96]">
                            Runs every 30 seconds to deliver timed nudges and
                            bi-hourly all-day reminders.
                          </p>
                        </div>
                        <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                          Active (30s tick)
                        </span>
                      </div>

                      <div className="p-4 flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-medium text-neutral-900 dark:text-white">
                            All-day nudge window
                          </div>
                          <p className="text-xs text-neutral-500 dark:text-[#8e8e96]">
                            All-day tasks notify every 2 hours between 09:00 and
                            21:00 local time.
                          </p>
                        </div>
                        <span className="text-xs text-neutral-500 dark:text-[#8e8e96]">
                          09:00 - 21:00
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: DATA CONTROLS */}
              {activeTab === "data-controls" && (
                <div className="space-y-6">
                  <h2 className="text-xl font-semibold text-neutral-900 dark:text-white tracking-tight">
                    Data Controls
                  </h2>

                  <div>
                    <div className="mb-2 text-xs font-medium text-neutral-500 dark:text-[#8e8e96]">
                      Backup & Migration
                    </div>
                    <div className="overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50/50 divide-y divide-neutral-200 dark:border-white/[0.08] dark:bg-[#1e1e22]/90 dark:divide-white/[0.06]">
                      <div className="p-4 flex items-center justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <DatabaseIcon className="mt-0.5 size-4 text-neutral-500 dark:text-[#8e8e96]" />
                          <div>
                            <div className="text-sm font-medium text-neutral-900 dark:text-white">
                              Export data
                            </div>
                            <p className="text-xs text-neutral-500 dark:text-[#8e8e96]">
                              Download conversations, messages, memories, and
                              reminders as JSON.
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={exporting}
                          onClick={() => void handleExport()}
                          className="h-8 text-xs"
                        >
                          <DownloadIcon className="size-3.5 me-1" />
                          Export
                        </Button>
                      </div>

                      <div className="p-4 flex items-center justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <UploadIcon className="mt-0.5 size-4 text-neutral-500 dark:text-[#8e8e96]" />
                          <div>
                            <div className="text-sm font-medium text-neutral-900 dark:text-white">
                              Import backup
                            </div>
                            <p className="text-xs text-neutral-500 dark:text-[#8e8e96]">
                              Merge a previously exported JSON file.
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={importing}
                          onClick={() => importRef.current?.click()}
                          className="h-8 text-xs"
                        >
                          <UploadIcon className="size-3.5 me-1" />
                          Import
                        </Button>
                        <input
                          ref={importRef}
                          type="file"
                          accept="application/json,.json"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            if (f) void handleImportFile(f);
                          }}
                        />
                      </div>

                      <div className="p-4 flex items-center justify-between gap-4">
                        <div className="flex items-start gap-3">
                          <RefreshCwIcon className="mt-0.5 size-4 text-neutral-500 dark:text-[#8e8e96]" />
                          <div>
                            <div className="text-sm font-medium text-neutral-900 dark:text-white">
                              Rebuild memories
                            </div>
                            <p className="text-xs text-neutral-500 dark:text-[#8e8e96]">
                              Re-extract and re-embed all conversations from
                              history.
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={rebuilding}
                          onClick={() => void rebuildMemory()}
                          className="h-8 text-xs"
                        >
                          <RefreshCwIcon
                            className={cn(
                              "size-3.5 me-1",
                              rebuilding && "animate-spin",
                            )}
                          />
                          Rebuild
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <div className="mb-2 text-xs font-medium text-destructive">
                      Danger Zone
                    </div>
                    <div className="overflow-hidden rounded-xl border border-destructive/20 bg-destructive/5 divide-y divide-destructive/10">
                      <div className="p-4 flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-medium text-neutral-900 dark:text-white">
                            Clear extracted memories
                          </div>
                          <p className="text-xs text-neutral-500 dark:text-[#8e8e96]">
                            Deletes all durable facts. Past messages remain.
                          </p>
                        </div>
                        <Button
                          variant="destructive-outline"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => setClearMemoryOpen(true)}
                        >
                          Clear Memory
                        </Button>
                      </div>

                      <div className="p-4 flex items-center justify-between gap-4">
                        <div>
                          <div className="text-sm font-medium text-neutral-900 dark:text-white">
                            Clear all local data
                          </div>
                          <p className="text-xs text-neutral-500 dark:text-[#8e8e96]">
                            Permanently wipes database, files, and chat history.
                          </p>
                        </div>
                        <Button
                          variant="destructive"
                          size="sm"
                          className="h-8 text-xs"
                          onClick={() => setClearDataOpen(true)}
                        >
                          Delete All
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB: USAGE */}
              {activeTab === "usage" && (
                <div className="space-y-6">
                  <h2 className="text-xl font-semibold text-neutral-900 dark:text-white tracking-tight">
                    Usage
                  </h2>

                  <div>
                    <div className="mb-2 text-xs font-medium text-neutral-500 dark:text-[#8e8e96]">
                      Metrics & Storage
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Stat
                        label="Memories"
                        value={memory?.stats.memories ?? 0}
                      />
                      <Stat
                        label="Messages"
                        value={memory?.stats.messages ?? 0}
                      />
                      <Stat
                        label="Embeddings"
                        value={memory?.embedding.state ?? "ready"}
                      />
                      <Stat
                        label="Dimension"
                        value={memory?.embedding.dimension ?? 384}
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-neutral-200 bg-neutral-50/50 p-4 dark:border-white/[0.08] dark:bg-[#1e1e22]/90">
                    <div className="text-sm font-medium text-neutral-900 dark:text-white">
                      Local Embedding Model
                    </div>
                    <div className="mt-1 text-xs text-neutral-500 dark:text-[#8e8e96]">
                      {memory?.embedding.model ?? "bge-small-en-v1.5"} (384-dim,
                      fastembed ONNX runtime, zero cloud dependency)
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
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
        description="This permanently removes every conversation, message, memory, reminder, and uploaded file. Export first if you want a backup."
        confirmLabel="Delete everything"
        destructive
        onConfirm={() => void clearData()}
      />

      <ConfirmDialog
        open={pendingImport !== null}
        onOpenChange={(v) => {
          if (!v) setPendingImport(null);
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
    <div className="rounded-xl border border-neutral-200 bg-neutral-50/50 p-3 dark:border-white/[0.08] dark:bg-[#1e1e22]/90">
      <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500 dark:text-[#8e8e96]">
        {label}
      </div>
      <div className="mt-0.5 truncate text-lg font-semibold tabular-nums text-neutral-900 dark:text-white">
        {value}
      </div>
    </div>
  );
}

function NumberSetting({
  value,
  min,
  max,
  onCommit,
}: {
  value: string;
  min: number;
  max: number;
  onCommit: (val: number) => void;
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
    <Input
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="h-8 w-20 text-center text-xs"
    />
  );
}

function ThemeSetting({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  const { setTheme } = useTheme();

  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50/50 p-4 dark:border-white/[0.08] dark:bg-[#1e1e22]/90">
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { id: "system", label: "System", icon: LaptopIcon },
          { id: "light", label: "Light", icon: SunIcon },
          { id: "dark", label: "Dark", icon: MoonIcon },
        ].map((item) => {
          const Icon = item.icon;
          const isCurrent = value === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                setTheme(item.id as "system" | "light" | "dark");
                onChange(item.id);
              }}
              className={cn(
                "flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition-all cursor-pointer",
                isCurrent
                  ? "border-neutral-900 bg-neutral-200/80 text-neutral-900 shadow-xs dark:border-white/[0.3] dark:bg-white/[0.08] dark:text-white"
                  : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-[#8e8e96] dark:hover:bg-white/[0.05] dark:hover:text-white",
              )}
            >
              <Icon className="size-5" />
              <span className="text-xs font-medium">{item.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ProviderAccordionItem({
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
      const response = await api.testProvider(
        provider.id,
        model.trim() || undefined,
      );
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
    <AccordionItem
      value={provider.id}
      className="border-b border-neutral-200 dark:border-white/[0.06] last:border-b-0"
    >
      <div className="flex items-center justify-between gap-3 pe-4 transition-colors hover:bg-neutral-100/50 dark:hover:bg-white/[0.02]">
        <AccordionTrigger className="flex-1 min-w-0 py-3.5 ps-4 pe-2 hover:no-underline">
          <div className="flex items-center gap-2.5 truncate">
            <span className="font-medium text-sm text-neutral-900 dark:text-white truncate">
              {provider.name}
            </span>
            {provider.hasApiKey && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400 shrink-0">
                <CheckCircle2Icon className="size-2.5" />
                saved
              </span>
            )}
            {provider.defaultModel && (
              <span className="hidden truncate font-mono text-xs text-neutral-500 dark:text-[#8e8e96] sm:inline max-w-[200px]">
                {provider.defaultModel}
              </span>
            )}
          </div>
        </AccordionTrigger>

        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={enabled}
            onCheckedChange={(checked) => {
              setEnabled(checked);
              void save(checked);
            }}
          />
        </div>
      </div>

      <AccordionPanel className="px-4 pb-4 pt-1">
        <p className="mb-3 text-xs text-neutral-500 dark:text-[#8e8e96]">
          {PROVIDER_HELP[provider.type]}
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs text-neutral-500 dark:text-[#8e8e96]">API key</Label>
            <Input
              type="password"
              autoComplete="off"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={
                provider.apiKeyPreview
                  ? `Saved ${provider.apiKeyPreview}`
                  : provider.type === "ollama"
                    ? "Not required for Ollama"
                    : "Paste API key"
              }
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-neutral-500 dark:text-[#8e8e96]">Default model</Label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Model id"
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-xs text-neutral-500 dark:text-[#8e8e96]">Base URL</Label>
            <Input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={PROVIDER_BASE_HINT[provider.type]}
              className="h-8 text-xs"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={saving}
            onClick={() => void save()}
            className="h-7 px-3 text-xs"
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={testing || saving}
            onClick={() => void test()}
            className="h-7 text-xs"
          >
            {testing ? "Testing…" : "Test connection"}
          </Button>
          {result && (
            <span
              className={cn(
                "text-xs inline-flex items-center gap-1",
                result.ok ? "text-emerald-500 dark:text-emerald-400" : "text-destructive",
              )}
            >
              {result.ok ? (
                <CheckCircle2Icon className="size-3" />
              ) : (
                <TriangleAlertIcon className="size-3" />
              )}
              {result.message}
            </span>
          )}
        </div>
      </AccordionPanel>
    </AccordionItem>
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
    <div className="mt-3 grid gap-2 border-t border-neutral-200 dark:border-white/[0.08] pt-3 sm:grid-cols-2">
      <div className="space-y-1">
        <Label className="text-xs text-neutral-500 dark:text-[#8e8e96]">Name</Label>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="LM Studio"
          className="h-8 text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-neutral-500 dark:text-[#8e8e96]">Default model</Label>
        <Input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="local-model"
          className="h-8 text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-neutral-500 dark:text-[#8e8e96]">Base URL</Label>
        <Input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={baseUrl}
          className="h-8 text-xs"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-neutral-500 dark:text-[#8e8e96]">API key (optional)</Label>
        <Input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Optional"
          className="h-8 text-xs"
        />
      </div>
      <div className="sm:col-span-2 pt-1">
        <Button
          size="sm"
          disabled={saving}
          onClick={() => void create()}
          className="h-8 px-3 text-xs"
        >
          <PlusIcon className="size-3.5 me-1" />
          Add provider
        </Button>
      </div>
    </div>
  );
}
