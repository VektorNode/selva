<script lang="ts">
  import type { Snippet } from "svelte";
  import Badge from "./Badge.svelte";

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
</script>

<header
  class={`bg-gradient-to-b from-white to-gray-50 border-b border-gray-100 px-8 py-3 backdrop-blur-sm transition-all duration-200 ${className}`}
>
  <div class="flex items-center justify-between gap-4">
    <div class="flex-1">
      <h1 class="text-2xl font-bold text-gray-900 mb-1">
        {title}
      </h1>

      {#if sessionId || badge || children}
        <div class="flex items-center gap-2 text-gray-500 text-xs">
          {#if sessionId}
            <span class="flex items-center gap-1.5">
              <span class="text-gray-400">Session:</span>
              <code
                class="bg-gray-100 rounded px-2 py-0.5 font-mono text-xs font-medium text-gray-700"
              >
                {sessionId}
              </code>
            </span>
          {/if}

          {#if sessionId && (badge || children)}
            <div class="w-px h-3 bg-gray-200"></div>
          {/if}

          {#if badge}
            <Badge variant={badge.variant} size="small">
              {badge.label}
            </Badge>
          {/if}

          {#if children}
            {@render children()}
          {/if}
        </div>
      {/if}
    </div>
  </div>
</header>

<style>
  :global(header) {
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.08),
      0 0 0 1px rgba(0, 0, 0, 0.02);
  }
</style>
