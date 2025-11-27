<script lang="ts">
  import type { AvailableParameter, AvailableOutput } from '$lib/types/generated';
  import StateDisplay from '../ui/StateDisplay.svelte';
  import DraggableItem from './DraggableItem.svelte';

  interface AvailableItemListProps {
    items: (AvailableParameter | AvailableOutput)[];
    title: string;
    placedIds?: Set<string>;
    emptyMessage?: string;
  }

  let {
    items,
    title,
    placedIds = new Set(),
    emptyMessage = 'No items found.',
  }: AvailableItemListProps = $props();

  const availableItems = $derived(items.filter((i) => !placedIds.has(i.id)));
</script>

<div class="mb-6">
  <h3 class="mb-3 flex items-center gap-2 text-base font-semibold text-foreground">
    {title} ({availableItems.length})
  </h3>
  {#if availableItems.length === 0}
    <StateDisplay type="empty" size="small" message={emptyMessage} />
  {:else}
    <div class="flex flex-col gap-0">
      {#each availableItems as item (item.id)}
        <DraggableItem {item} />
      {/each}
    </div>
  {/if}
</div>
