<script lang="ts">
  import type { AvailableParameter } from "$lib/types/schema";
  import StateDisplay from "../ui/StateDisplay.svelte";
  import DraggableParameter from "./DraggableParameter.svelte";

  interface ParameterListProps {
    title: string;
    icon: string; //Icon name for Iconify
    parameters: AvailableParameter[];
    category: "input" | "output";
    emptyMessage?: string;
  }

  let {
    title,
    parameters,
    category,
    emptyMessage = "No parameters found.",
  }: ParameterListProps = $props();
</script>

<div class="mb-6">
  <h3
    class="text-base font-semibold text-gray-700 mb-3 flex items-center gap-2"
  >
    {title} ({parameters.length})
  </h3>
  {#if parameters.length === 0}
    <StateDisplay type="empty" size="small" message={emptyMessage} />
  {:else}
    <div class="flex flex-col gap-0">
      {#each parameters as param}
        <DraggableParameter parameter={param} {category} />
      {/each}
    </div>
  {/if}
</div>
