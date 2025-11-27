<script lang="ts">
  import type { DownloadableComponent } from '$lib/types/generated';
  import StateDisplay from '../ui/StateDisplay.svelte';
  import DraggableItem from './DraggableItem.svelte';

  interface DownloadableComponentsListProps {
    components: DownloadableComponent[];
    placedIds?: Set<string>;
    emptyMessage?: string;
  }

  let {
    components,
    placedIds = new Set(),
    emptyMessage = 'No downloadable components found.',
  }: DownloadableComponentsListProps = $props();

  const availableComponents = $derived(components.filter((c) => !placedIds.has(c.id)));
</script>

<div class="mb-6">
  <h3 class="mb-3 flex items-center gap-2 text-base font-semibold text-foreground">
    💾 Downloads ({availableComponents.length})
  </h3>
  {#if availableComponents.length === 0}
    <StateDisplay type="empty" size="small" message={emptyMessage} />
  {:else}
    <div class="flex flex-col gap-0">
      {#each availableComponents as component}
        <DraggableItem item={component} type="downloadable" />
      {/each}
    </div>
  {/if}
</div>
