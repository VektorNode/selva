<script lang="ts">
  import type { Snippet } from 'svelte';
  import { Badge } from '$lib/components/ui/badge';
  import { ModeToggle } from '$lib/components/ui/mode-toggle';
  import { ThemeSwitcher } from '$lib/components/ui/theme-switcher';

  interface BadgeConfig {
    label: string;
    variant: 'connected' | 'disconnected' | 'solving' | 'compute';
  }

  interface PageHeaderProps {
    title: string;
    sessionId?: string;
    badge?: BadgeConfig;
    showModeToggle?: boolean;
    showThemeSwitcher?: boolean;
    children?: Snippet;
    class?: string;
  }

  let {
    title,
    sessionId,
    badge,
    children,
    class: className = '',
    showModeToggle = false,
    showThemeSwitcher = false,
  }: PageHeaderProps = $props();

  // Map custom variants to colors
  const badgeStyles: Record<string, string> = {
    connected: 'bg-green-500 text-white border-transparent',
    disconnected: 'bg-red-500 text-white border-transparent',
    solving: 'bg-orange-500 text-white border-transparent',
    compute: 'bg-blue-500 text-white border-transparent',
  };
</script>

<header
  class={`border-b border-border bg-linear-to-b from-background to-muted/50 px-6 py-3 backdrop-blur-sm transition-all duration-200 ${className}`}
>
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <!-- Left section -->
    <div class="min-w-0 flex-1">
      <h1 class="text-xl font-bold text-foreground sm:text-2xl">
        {title}
      </h1>

      {#if sessionId || badge || children}
        <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {#if children}
            {@render children()}
          {/if}

          {#if sessionId}
            <span class="flex items-center gap-1.5 max-w-full">
              <span>Session:</span>
              <code
                class="max-w-[60vw] truncate rounded bg-muted px-2 py-0.5 font-mono text-xs font-medium text-foreground sm:max-w-none"
              >
                {sessionId}
              </code>
            </span>
          {/if}

          {#if sessionId && (badge || children)}
            <div class="h-3 w-px bg-border"></div>
          {/if}

          {#if badge}
            <Badge class={badgeStyles[badge.variant]}>
              {badge.label}
            </Badge>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Right section (Theme & Mode Toggle) -->
    {#if showModeToggle || showThemeSwitcher}
      <div class="flex items-center gap-2 self-start sm:self-center">
        {#if showThemeSwitcher}
          <ThemeSwitcher />
        {/if}
        {#if showModeToggle}
          <ModeToggle />
        {/if}
      </div>
    {/if}
  </div>
</header>

<style>
  :global(header) {
    box-shadow:
      0 1px 3px rgba(0, 0, 0, 0.08),
      0 0 0 1px rgba(0, 0, 0, 0.02);
  }
</style>
