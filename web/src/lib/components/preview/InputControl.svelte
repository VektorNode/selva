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
  import { Input } from "$lib/components/ui/input";
  import { Slider } from "$lib/components/ui/slider";
  import { Checkbox } from "$lib/components/ui/checkbox";
  import { Label } from "$lib/components/ui/label";
  import * as Select from "$lib/components/ui/select";

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

  // For slider, get numeric value
  let sliderValue = $derived(
    isSliderWidget(item) ? (typeof value === "number" ? value : 0) : 0
  );
</script>

<div class="flex flex-col gap-2">
  <Label for={inputId} class="flex items-center gap-2">
    {displayName || item.displayName || item.paramId}
    {#if item.config}
      <span class="cursor-help text-xs opacity-60">ℹ️</span>
    {/if}
  </Label>

  {#if isNumberWidget(item)}
    {@const config = item.config as NumberWidgetConfig}
    <Input
      id={inputId}
      type="number"
      bind:value
      min={config.min}
      max={config.max}
      step={config.step ?? 1}
      placeholder={config.placeholder}
      oninput={(e) => {
        const target = e.currentTarget as HTMLInputElement;
        const newValue = parseFloat(target.value);
        if (!isNaN(newValue)) {
          handleChange(newValue);
        }
      }}
    />
  {:else if isSliderWidget(item)}
    {@const config = item.config as SliderWidgetConfig}
    <div class="flex items-center gap-4">
      <Slider
        type="single"
        value={sliderValue}
        min={config.min}
        max={config.max}
        step={config.step ?? 1}
        class="flex-1"
        onValueChange={(val: number) => {
          handleChange(val);
        }}
      />
      <span class="text-sm text-muted-foreground min-w-12 text-right">
        {value ?? config.min}
      </span>
    </div>
  {:else if isCheckboxWidget(item)}
    {@const _config = item.config as CheckboxWidgetConfig}
    <div class="flex items-center gap-3">
      <Checkbox
        id={inputId}
        checked={value}
        onCheckedChange={(checked) => handleChange(checked)}
      />
      <Label for={inputId} class="text-sm text-muted-foreground cursor-pointer">
        Enabled
      </Label>
    </div>
  {:else if isTextWidget(item)}
    {@const config = item.config as TextWidgetConfig}
    <Input
      id={inputId}
      type="text"
      bind:value
      placeholder={config.placeholder}
      oninput={(e) => {
        const target = e.currentTarget as HTMLInputElement;
        handleChange(target.value);
      }}
    />
  {:else if isDropdownWidget(item)}
    {@const config = item.config as DropdownWidgetConfig}
    <Select.Root
      type="single"
      value={value || undefined}
      onValueChange={(selected: string) => {
        if (selected) {
          handleChange(selected);
        }
      }}
    >
      <Select.Trigger class="w-full">
        {value || "Select an option..."}
      </Select.Trigger>
      <Select.Content>
        {#each config.options || [] as opt}
          <Select.Item value={opt} label={opt} />
        {/each}
      </Select.Content>
    </Select.Root>
  {/if}
</div>
