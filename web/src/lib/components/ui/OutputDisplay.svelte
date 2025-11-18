<script lang="ts">
  import type {
    OutputLayoutItem,
    TextDisplayConfig,
    NumberDisplayConfig,
  } from "$lib/types/schema";

  interface Props {
    item: OutputLayoutItem;
    value: any;
    displayName?: string;
  }

  let { item, value, displayName }: Props = $props();

  function isTextDisplay(
    item: OutputLayoutItem
  ): item is Extract<OutputLayoutItem, { widgetType: "text" }> {
    return item.widgetType === "text";
  }

  function isNumberDisplay(
    item: OutputLayoutItem
  ): item is Extract<OutputLayoutItem, { widgetType: "number" }> {
    return item.widgetType === "number";
  }

  function formatValue(val: any, config: any): string {
    if (val === null || val === undefined) return "";

    if (typeof val === "object") {
      return JSON.stringify(val, null, 2);
    }

    // Apply format if specified
    if (config?.format && typeof val === "number") {
      return val.toFixed(parseInt(config.format) || 2);
    }

    return String(val);
  }
</script>

<div class="flex flex-col gap-2">
  <h3 class="flex items-center gap-2 font-medium text-gray-900 text-sm">
    {displayName || item.displayName || item.paramId}
  </h3>

  {#if isTextDisplay(item)}
    {@const config = item.config as TextDisplayConfig}
    <div
      class="px-3 py-3 bg-gray-50 border border-gray-200 rounded font-mono min-h-[50px] text-sm whitespace-pre-wrap wrap-break-word"
    >
      {#if value !== null && value !== undefined}
        {formatValue(value, config)}
      {:else}
        <span class="text-gray-500 not-italic">Waiting for data...</span>
      {/if}
    </div>
  {:else if isNumberDisplay(item)}
    {@const config = item.config as NumberDisplayConfig}
    <div
      class="px-3 py-3 bg-gray-50 border border-gray-200 rounded font-mono min-h-[50px] text-sm"
    >
      {#if value !== null && value !== undefined}
        <span class="font-bold text-blue-600">{formatValue(value, config)}</span
        >
      {:else}
        <span class="text-gray-500 not-italic">Waiting for data...</span>
      {/if}
    </div>
  {/if}
</div>
