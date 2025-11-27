<script lang="ts">
  import type { AvailableParameter } from '$lib/types/generated';
  import StateDisplay from '../ui/StateDisplay.svelte';
  import DraggableItem from './DraggableItem.svelte';

  interface InputListProps {
    inputs: AvailableParameter[];
    placedIds?: Set<string>;
    emptyMessage?: string;
  }

  let {
    inputs,
    placedIds = new Set(),
    emptyMessage = 'No contextual parameters found.',
  }: InputListProps = $props();

  const availableInputs = $derived(inputs.filter((i) => !placedIds.has(i.id)));
</script>

<div class="mb-6">
  <h3 class="mb-3 flex items-center gap-2 text-base font-semibold text-foreground">
    📥 Inputs ({availableInputs.length})
  </h3>
  {#if availableInputs.length === 0}
    <StateDisplay type="empty" size="small" message={emptyMessage} />
  {:else}
    <div class="flex flex-col gap-0">
      {#each availableInputs as input}
        <DraggableItem item={input} type="parameter" category="input" />
      {/each}
    </div>
  {/if}
</div>
