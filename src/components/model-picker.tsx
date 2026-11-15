"use client";

import { CheckIcon, ChevronsUpDownIcon, SettingsIcon } from "lucide-react";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { Button } from "@/components/ui/button";
import { ProviderBadge } from "@/components/provider-badge";
import { modelOptions, providerColor } from "@/lib/models";
import type { PublicProvider } from "@/lib/types";

export function ModelPicker({
  providers,
  providerId,
  model,
  onChange,
  onOpenSettings,
}: {
  providers: PublicProvider[];
  providerId: string;
  model: string;
  onChange: (providerId: string, model: string) => void;
  onOpenSettings?: () => void;
}) {
  const enabled = providers.filter((provider) => provider.enabled);
  const current = providers.find((provider) => provider.id === providerId);

  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="max-w-56 gap-1.5 text-muted-foreground"
          />
        }
      >
        <ProviderBadge provider={current} />
        <span className="truncate">{model || "Select a model"}</span>
        <ChevronsUpDownIcon className="text-muted-foreground" />
      </MenuTrigger>
      <MenuPopup align="start" className="w-64">
        {enabled.length === 0 ? (
          <div className="px-2 py-3 text-muted-foreground text-sm">
            No providers enabled yet.
          </div>
        ) : (
          enabled.map((provider, index) => (
            <MenuGroup key={provider.id}>
              {index > 0 && <MenuSeparator />}
              <MenuGroupLabel className="flex items-center gap-2">
                <span
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: providerColor(provider.type) }}
                />
                {provider.name}
              </MenuGroupLabel>
              {modelOptions(provider).map((name) => {
                const active = provider.id === providerId && name === model;
                return (
                  <MenuItem
                    key={`${provider.id}:${name}`}
                    onClick={() => onChange(provider.id, name)}
                  >
                    <span className="truncate">{name}</span>
                    {active && <CheckIcon className="ms-auto" />}
                  </MenuItem>
                );
              })}
            </MenuGroup>
          ))
        )}
        {onOpenSettings && (
          <>
            <MenuSeparator />
            <MenuItem onClick={onOpenSettings}>
              <SettingsIcon />
              Manage providers
            </MenuItem>
          </>
        )}
      </MenuPopup>
    </Menu>
  );
}
