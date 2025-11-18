<script lang="ts">
  import type {
    InputLayoutItem,
    SliderWidgetConfig,
    NumberWidgetConfig,
    TextWidgetConfig,
    DropdownWidgetConfig,
    CheckboxWidgetConfig,
  } from "$lib/types/schema";
  import {
    isSliderWidget,
    isNumberWidget,
    isTextWidget,
    isDropdownWidget,
    isCheckboxWidget,
  } from "$lib/types/schema";
  import { debounce } from "$lib/utils/debounce";
  import Input from "../ui/Input.svelte";
  import Select from "../ui/Select.svelte";

  interface Props {
    item: InputLayoutItem;
    value?: any;
    displayName?: string;
    onChange: (paramId: string, value: any) => void;
    debounceMs?: number;
  }

  let {
    item,
    value = $bindable(),
    displayName,
    onChange,
    debounceMs = 0,
  }: Props = $props();

  // Generate unique ID for accessibility
  const inputId = $derived(
    `input-${item.paramId}-${Math.random().toString(36).substring(2, 11)}`
  );

  const debouncedOnChange = debounce(
    (val: any) => onChange(item.paramId, val),
    debounceMs
  );

  function handleChange(newValue: any) {
    value = newValue;
    if (debounceMs > 0) {
      debouncedOnChange(newValue);
    } else {
      onChange(item.paramId, newValue);
    }
  }
</script>

<div class="flex flex-col gap-2">
  <label
    for={inputId}
    class="flex items-center gap-2 font-medium text-gray-900 text-sm"
  >
    {displayName || item.displayName || item.paramId}
    {#if item.config}
      <span class="cursor-help text-xs opacity-60">ℹ️</span>
    {/if}
  </label>

  {#if isNumberWidget(item)}
    {@const config = item.config as NumberWidgetConfig}
    <Input
      type="number"
      bind:value
      min={config.min}
      max={config.max}
      step={config.step ?? 1}
      placeholder={config.placeholder}
      oninput={(e) => {
        const newValue = parseFloat(e.currentTarget.value);
        if (!isNaN(newValue)) {
          handleChange(newValue);
        }
      }}
    />
  {:else if isSliderWidget(item)}
    {@const config = item.config as SliderWidgetConfig}
    <Input
      type="number"
      bind:value
      min={config.min}
      max={config.max}
      step={config.step ?? 1}
      oninput={(e) => {
        const newValue = parseFloat(e.currentTarget.value);
        if (!isNaN(newValue)) {
          handleChange(newValue);
        }
      }}
    />
  {:else if isCheckboxWidget(item)}
    {@const config = item.config as CheckboxWidgetConfig}
    <label class="flex items-center gap-3 cursor-pointer">
      <input
        id={inputId}
        type="checkbox"
        checked={value}
        class="w-5 h-5 cursor-pointer accent-blue-600"
        onchange={(e) => handleChange(e.currentTarget.checked)}
      />
      <span class="text-sm text-gray-700">Enabled</span>
    </label>
  {:else if isTextWidget(item)}
    {@const config = item.config as TextWidgetConfig}
    <Input
      type="text"
      bind:value
      placeholder={config.placeholder}
      oninput={(e) => handleChange(e.currentTarget.value)}
    />
  {:else if isDropdownWidget(item)}
    {@const config = item.config as DropdownWidgetConfig}
    <Select
      bind:value
      options={(config.options || []).map((opt) => ({
        value: opt,
        label: opt,
      }))}
      onchange={(e) => handleChange(e.currentTarget.value)}
    />
  {/if}
</div>
