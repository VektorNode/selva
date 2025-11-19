<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Card from "$lib/components/ui/card";

  interface PanelProps {
    title?: string;
    headerActions?: Snippet;
    padding?: "none" | "small" | "medium" | "large";
    border?: boolean;
    shadow?: boolean;
    class?: string;
    children: Snippet;
  }

  let {
    title,
    headerActions,
    padding = "medium",
    border = true,
    shadow = true,
    class: className = "",
    children,
  }: PanelProps = $props();

  const paddingClasses = {
    none: "p-0",
    small: "p-4",
    medium: "p-6",
    large: "p-8",
  };

  const borderClass = border ? "" : "border-0";
  const shadowClass = shadow ? "shadow-sm" : "shadow-none";

  const combinedClasses = $derived(
    `${borderClass} ${shadowClass} ${paddingClasses[padding]} ${className}`
  );
</script>

<Card.Root class={combinedClasses}>
  {#if title || headerActions}
    <Card.Header
      class="p-0  flex flex-row justify-between items-center space-y-0"
    >
      {#if title}
        <Card.Title class="text-xl">{title}</Card.Title>
      {/if}

      {#if headerActions}
        <div class="flex gap-2">
          {@render headerActions()}
        </div>
      {/if}
    </Card.Header>
  {/if}

  <Card.Content class="p-0">
    {@render children()}
  </Card.Content>
</Card.Root>
