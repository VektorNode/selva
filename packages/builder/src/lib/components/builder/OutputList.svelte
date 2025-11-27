<script lang="ts">
  import type { AvailableParameter } from '$lib/types/generated';
  import StateDisplay from '../ui/StateDisplay.svelte';
  import DraggableItem from './DraggableItem.svelte';

  interface OutputListProps {
    outputs: AvailableParameter[];
    placedIds?: Set<string>;
    emptyMessage?: string;
  }

  let {
    outputs,
    placedIds = new Set(),
    emptyMessage = 'No output components found.',
  }: OutputListProps = $props();

  const availableOutputs = $derived(outputs.filter((o) => !placedIds.has(o.id)));
</script>

<div class="mb-6">
  <h3 class="mb-3 flex items-center gap-2 text-base font-semibold text-foreground">
    📤 Outputs ({availableOutputs.length})
  </h3>
  {#if availableOutputs.length === 0}
    <StateDisplay type="empty" size="small" message={emptyMessage} />
  {:else}
    <div class="flex flex-col gap-0">
      {#each availableOutputs as output}
        <DraggableItem item={output} type="parameter" category="output" />
      {/each}
    </div>
  {/if}
</div>
