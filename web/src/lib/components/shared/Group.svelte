<script lang="ts">
  import type { Snippet } from "svelte";
  import Button from "./Button.svelte";

  interface GroupProps {
    label: string;
    description?: string;
    collapsed?: boolean;
    columns?: number;
    editable?: boolean;
    onRemove?: () => void;
    class?: string;
    children: Snippet;
  }

  let {
    label,
    description,
    collapsed = $bindable(false),
    columns = 2,
    editable = false,
    onRemove,
    class: className = "",
    children,
  }: GroupProps = $props();

  const gridClasses = $derived(`grid gap-4 grid-cols-${columns}`);
</script>

<div class={`border border-gray-200 rounded-lg bg-white ${className}`}>
  <button
    class="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
    onclick={() => (collapsed = !collapsed)}
  >
    <div class="flex-1">
      <h3 class="font-semibold text-gray-900">{label}</h3>
      {#if description}
        <p class="text-sm text-gray-500 mt-1">{description}</p>
      {/if}
    </div>

    <div class="flex items-center gap-2">
      {#if editable && onRemove}
        <Button
          variant="icon"
          onclick={(e: Event) => {
            e.stopPropagation();
            onRemove?.();
          }}
        >
          🗑️
        </Button>
      {/if}

      <span
        class="text-gray-500 transition-transform {collapsed
          ? ''
          : 'rotate-180'}"
      >
        ▼
      </span>
    </div>
  </button>

  {#if !collapsed}
    <div class="p-4 pt-0 border-t border-gray-100">
      <div class={gridClasses}>
        {@render children()}
      </div>
    </div>
  {/if}
</div>
