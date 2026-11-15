import { cn } from "@/lib/utils";
import { providerColor, providerInitial } from "@/lib/models";
import type { PublicProvider } from "@/lib/types";

export function ProviderBadge({
  provider,
  className,
  size = 18,
}: {
  provider: Pick<PublicProvider, "name" | "type"> | undefined;
  className?: string;
  size?: number;
}) {
  const name = provider?.name ?? "?";
  const type = provider?.type ?? "custom";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md font-semibold text-white",
        className,
      )}
      style={{
        width: size,
        height: size,
        backgroundColor: providerColor(type),
        fontSize: Math.max(9, size * 0.5),
      }}
    >
      {providerInitial(name)}
    </span>
  );
}
