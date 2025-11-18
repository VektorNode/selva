<script lang="ts">
  import type { Snippet } from "svelte";
  import { Badge } from "$lib/components/ui/badge";
  import { ModeToggle } from "$lib/components/ui/mode-toggle";
  import { cn } from "$lib/utils";

  interface BadgeConfig {
    label: string;
    variant: "connected" | "disconnected" | "solving" | "compute";
  }

  interface PageHeaderProps {
    title: string;
    sessionId?: string;
    badge?: BadgeConfig;
    children?: Snippet;
    class?: string;
  }

  let {
    title,
    sessionId,
    badge,
    children,
    class: className = "",
  }: PageHeaderProps = $props();

  // Map custom variants to colors
  const badgeStyles: Record<string, string> = {
    connected: "bg-green-500 text-white border-transparent",
    disconnected: "bg-red-500 text-white border-transparent",
    solving: "bg-orange-500 text-white border-transparent",
    compute: "bg-blue-500 text-white border-transparent",
  };
</script>

<header
  class={`bg-linear-to-b from-background to-muted/50 border-b border-border px-8 py-3 backdrop-blur-sm transition-all duration-200 ${className}`}
>
  <div class="flex items-center justify-between gap-4">
    <div class="flex-1">
      <h1 class="text-2xl font-bold text-foreground mb-1">
        {title}
      </h1>

      {#if sessionId || badge || children}
        <div class="flex items-center gap-2 text-muted-foreground text-xs">
          {#if sessionId}
            <span class="flex items-center gap-1.5">
              <span class="text-muted-foreground">Session:</span>
              <code
                class="bg-muted rounded px-2 py-0.5 font-mono text-xs font-medium text-foreground"
              >
                {sessionId}
              </code>
            </span>
          {/if}

          {#if sessionId && (badge || children)}
            <div class="w-px h-3 bg-border"></div>
          {/if}

          {#if badge}
            <Badge class={badgeStyles[badge.variant]}>
              {badge.label}
            </Badge>
          {/if}

          {#if children}
            {@render children()}
          {/if}
        </div>
      {/if}
    </div>
    <ModeToggle />
  </div>
</header>

<style>
  :global(header) {
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.08),
      0 0 0 1px rgba(0, 0, 0, 0.02);
  }
</style>
