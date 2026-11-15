"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MoreHorizontalIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { groupSessions } from "@/lib/format";
import type { BootstrapData, Session } from "@/lib/types";

export function AppSidebar({
  sessions,
  activeSessionId,
  bootstrap,
  search,
  onSearch,
  onSelectSession,
  onNewChat,
  onOpenSettings,
  onTogglePin,
  onRename,
  onDelete,
}: {
  sessions: Session[];
  activeSessionId: string | null;
  bootstrap: BootstrapData | null;
  search: string;
  onSearch: (query: string) => void;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onTogglePin: (session: Session) => void;
  onRename: (session: Session, title: string) => void;
  onDelete: (session: Session) => void;
}) {
  const { setOpenMobile, isMobile } = useSidebar();
  const [query, setQuery] = useState(search);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setQuery(search), [search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (query !== search) onSearch(query);
    }, 250);
    return () => clearTimeout(timer);
  }, [query, search, onSearch]);

  const pinned = useMemo(
    () => sessions.filter((session) => session.pinned),
    [sessions],
  );
  const groups = useMemo(
    () => groupSessions(sessions.filter((session) => !session.pinned)),
    [sessions],
  );

  function select(id: string) {
    onSelectSession(id);
    if (isMobile) setOpenMobile(false);
  }

  function beginRename(session: Session) {
    setEditingId(session.id);
    setDraft(session.title);
    requestAnimationFrame(() => inputRef.current?.select());
  }

  function commitRename(session: Session) {
    const title = draft.trim();
    setEditingId(null);
    if (title && title !== session.title) onRename(session, title);
  }

  function renderItem(session: Session) {
    if (editingId === session.id) {
      return (
        <SidebarMenuItem key={session.id}>
          <div className="px-1 py-0.5">
            <SidebarInput
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => commitRename(session)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitRename(session);
                if (event.key === "Escape") setEditingId(null);
              }}
              aria-label="Conversation title"
            />
          </div>
        </SidebarMenuItem>
      );
    }

    return (
      <SidebarMenuItem key={session.id}>
        <SidebarMenuButton
          isActive={session.id === activeSessionId}
          tooltip={session.title}
          onClick={() => select(session.id)}
          className="pe-8"
        >
          {session.pinned && (
            <PinIcon className="size-3 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate">{session.title}</span>
        </SidebarMenuButton>
        <Menu>
          <MenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Conversation actions"
                className="absolute top-1 right-1 text-muted-foreground opacity-0 transition-opacity group-hover/menu-item:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100"
              />
            }
          >
            <MoreHorizontalIcon />
          </MenuTrigger>
          <MenuPopup align="start" side="right" sideOffset={6}>
            <MenuItem onClick={() => beginRename(session)}>
              <PencilIcon />
              Rename
            </MenuItem>
            <MenuItem onClick={() => onTogglePin(session)}>
              {session.pinned ? <PinOffIcon /> : <PinIcon />}
              {session.pinned ? "Unpin" : "Pin"}
            </MenuItem>
            <MenuSeparator />
            <MenuItem variant="destructive" onClick={() => onDelete(session)}>
              <Trash2Icon />
              Delete
            </MenuItem>
          </MenuPopup>
        </Menu>
      </SidebarMenuItem>
    );
  }

  return (
    <Sidebar variant="inset" collapsible="offcanvas">
      <SidebarHeader className="gap-3 pt-2">
        <div className="flex items-center gap-2 px-1">
          <div className="flex size-8 items-center justify-center rounded-lg bg-foreground text-background shadow-sm">
            <span className="font-semibold text-lg leading-none">m</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold text-sm">Minimi</div>
            <div className="truncate text-muted-foreground text-xs">
              local-first agent
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          className="w-full justify-start gap-2"
          onClick={() => {
            onNewChat();
            if (isMobile) setOpenMobile(false);
          }}
        >
          <PlusIcon />
          New chat
        </Button>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <SidebarInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations"
            className="ps-8"
            aria-label="Search conversations"
          />
        </div>
      </SidebarHeader>

      <SidebarContent className="gap-0">
        {pinned.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="gap-1.5">
              <PinIcon className="size-3" />
              Pinned
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{pinned.map(renderItem)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>{group.sessions.map(renderItem)}</SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}

        {sessions.length === 0 && (
          <div className="px-3 py-8 text-center text-muted-foreground text-xs">
            {search
              ? "No conversations match your search."
              : "No conversations yet. Start chatting to build your history."}
          </div>
        )}
      </SidebarContent>

      <SidebarFooter className="border-t">
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <span
              className={
                bootstrap?.embedding.state === "ready"
                  ? "size-1.5 rounded-full bg-emerald-500"
                  : "size-1.5 rounded-full bg-amber-500"
              }
            />
            {bootstrap?.embedding.state === "ready"
              ? "Memory ready"
              : "Memory warming up"}
          </div>
          <span className="text-muted-foreground text-[11px]">
            {bootstrap?.memory.memories ?? 0} memories
          </span>
        </div>
        <Button
          variant="ghost"
          className="w-full justify-start gap-2"
          onClick={() => {
            onOpenSettings();
            if (isMobile) setOpenMobile(false);
          }}
        >
          <SettingsIcon />
          Settings
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
