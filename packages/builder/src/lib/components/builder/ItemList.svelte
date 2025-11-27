<script lang="ts">
  import type { AvailableParameter, DownloadableComponent } from '$lib/types/generated';
  import StateDisplay from '../ui/StateDisplay.svelte';
  import DraggableItem from './DraggableItem.svelte';

  interface ItemListProps {
    items: AvailableParameter[] | DownloadableComponent[];
    type: 'input' | 'output' | 'downloadable';
    placedIds?: Set<string>;
    emptyMessage?: string;
    title?: string;
    icon?: string;
  }

  let {
    items,
    type,
    placedIds = new Set(),
    emptyMessage,
    title,
    icon,
  }: ItemListProps = $props();

  // Default messages and icons based on type
  const defaultTitles = {
    input: 'Inputs',
    output: 'Outputs',
    downloadable: 'Downloads',
  };

  const defaultIcons = {
    input: '📥',
    output: '📤',
    downloadable: '💾',
  };

  const defaultMessages = {
    input: 'No contextual parameters found.',
    output: 'No output components found.',
    downloadable: 'No downloadable components found.',
  };

  const resolvedTitle = title || defaultTitles[type];
  const resolvedIcon = icon || defaultIcons[type];
  const resolvedEmptyMessage = emptyMessage || defaultMessages[type];

  const availableItems = $derived(items.filter((item) => !placedIds.has(item.id)));
</script>

<div class="mb-6">
  <h3 class="mb-3 flex items-center gap-2 text-base font-semibold text-foreground">
    {resolvedIcon} {resolvedTitle} ({availableItems.length})
  </h3>
  {#if availableItems.length === 0}
    <StateDisplay type="empty" size="small" message={resolvedEmptyMessage} />
  {:else}
    <div class="flex flex-col gap-0">
      {#each availableItems as item}
        {#if type === 'downloadable'}
          <DraggableItem {item} type="downloadable" />
        {:else}
          <DraggableItem {item} type="parameter" category={type} />
        {/if}
      {/each}
    </div>
  {/if}
</div>
