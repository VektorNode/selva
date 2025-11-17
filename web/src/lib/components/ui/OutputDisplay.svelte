<script lang="ts">
  import type { OutputParameter } from "$lib/types/schema";

  interface Props {
    output: OutputParameter;
    value: any;
    displayName?: string;
  }

  let { output, value, displayName }: Props = $props();
</script>

<div class="flex flex-col gap-2">
  <label class="flex items-center gap-2 font-medium text-gray-900 text-sm">
    {displayName || output.name}
  </label>

  <div
    class="px-3 py-3 bg-gray-50 border border-gray-200 rounded font-mono min-h-[50px] text-sm whitespace-pre-wrap break-words"
  >
    {#if value !== null && value !== undefined}
      {typeof value === "object" ? JSON.stringify(value, null, 2) : value}
    {:else}
      <span class="text-gray-500 not-italic">Waiting for data...</span>
    {/if}
  </div>

  <!-- {#if output.description}
    <p class="text-xs text-gray-600 m-0 italic">
      {output.description}
    </p>
  {/if} -->
</div>
