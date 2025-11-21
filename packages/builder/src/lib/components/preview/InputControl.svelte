<script lang="ts">
  import type {
    InputLayoutItem,
    NumberWidgetConfig,
    TextWidgetConfig,
    DropdownWidgetConfig,
    SupportedTypes,
  } from '$lib/types/generated';
  import {
    isNumberWidget,
    isTextWidget,
    isDropdownWidget,
    isCheckboxWidget,
  } from '$lib/types/generated';
  import { debounce } from '$lib/utils/debounce';
  import { Input } from '$lib/components/ui/input';
  import { Slider } from '$lib/components/ui/slider';
  import { Checkbox } from '$lib/components/ui/checkbox';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';
  import * as Dialog from '$lib/components/ui/dialog';

  interface Props {
    item: InputLayoutItem;
    value?: unknown;
    displayName?: string;
    onChange: (paramId: string, value: SupportedTypes) => void;
  }

  let { item, value = $bindable(), displayName, onChange }: Props = $props();

  const inputId = $derived(`input-${item.paramId}-${Math.random().toString(36).substring(2, 11)}`);

  function handleChange(newValue: SupportedTypes) {
    value = newValue;
    onChange(item.paramId, newValue);
  }

  const debouncedOnChange = debounce((paramId: string, newValue: SupportedTypes) => {
    onChange(paramId, newValue);
  }, 150);

  function handleSliderChange(newValue: number) {
    // Update local value immediately for smooth UI
    value = newValue;
    debouncedOnChange(item.paramId, newValue);
  }

  // Calculate optimal step size for slider performance
  // If step size would create >1000 steps, adjust it automatically
  function getOptimalStepSize(min: number, max: number, requestedStep: number): number {
    const range = max - min;
    const totalSteps = range / requestedStep;

    // If more than 1000 steps, adjust step size to keep it under 1000
    if (totalSteps > 1000) {
      console.warn(
        `Adjusting step size from ${requestedStep} to ${range / 1000} for parameter ${item.paramId} to limit total steps to 1000.`
      );
      return range / 1000;
    }

    return requestedStep;
  }
</script>

<div class="flex flex-col gap-2">
  <div class="flex items-center gap-2">
    <Label for={inputId}>
      {displayName || item.displayName || item.paramId}
    </Label>
    {#if item.description}
      <Dialog.Root>
        <Dialog.Trigger
          class="cursor-help text-xs opacity-60 transition-opacity hover:opacity-100"
        ></Dialog.Trigger>
        <Dialog.Content class="sm:max-w-md">
          <Dialog.Header>
            <Dialog.Title>{displayName || item.displayName || item.paramId}</Dialog.Title>
            <Dialog.Description>
              {item.description}
            </Dialog.Description>
          </Dialog.Header>
        </Dialog.Content>
      </Dialog.Root>
    {/if}
  </div>

  {#if isNumberWidget(item)}
    {@const config = item.config as NumberWidgetConfig}
    {#if config.renderAsSlider}
      {@const minVal = config.minimum ?? 0}
      {@const maxVal = config.maximum ?? 100}
      {@const requestedStep = config.step ?? 1}
      {@const optimalStep = getOptimalStepSize(minVal, maxVal, requestedStep)}
      <div class="flex items-center gap-4">
        <Slider
          type="single"
          value={typeof value === 'number' ? value : minVal}
          min={minVal}
          max={maxVal}
          step={optimalStep}
          class="flex-1"
          onValueChange={handleSliderChange}
        />
        <span class="min-w-12 text-right text-sm text-muted-foreground">
          {typeof value === 'number'
            ? value.toFixed(Math.max(0, -Math.floor(Math.log10(requestedStep))))
            : minVal}
        </span>
      </div>
    {:else}
      <Input
        id={inputId}
        type="number"
        bind:value
        min={config.minimum}
        max={config.maximum}
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
    {/if}
  {:else if isCheckboxWidget(item)}
    <div class="flex items-center gap-3">
      <Checkbox
        id={inputId}
        checked={typeof value === 'boolean' ? value : false}
        onCheckedChange={(checked) => handleChange(checked)}
      />
      <Label for={inputId} class="cursor-pointer text-sm text-muted-foreground">Enabled</Label>
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
    {@const optionsArray = Object.entries(config.options || {})}
    <Select.Root
      type="single"
      value={typeof value === 'string' ? value : undefined}
      onValueChange={(selected: string) => {
        if (selected) {
          handleChange(selected);
        }
      }}
    >
      <Select.Trigger class="w-full">
        {#if typeof value === 'string'}
          {optionsArray.find(([key]) => key === value)?.[0] || value}
        {:else}
          Select an option...
        {/if}
      </Select.Trigger>
      <Select.Content>
        {#each optionsArray as [key, label]}
          <Select.Item value={key} label={key} />
        {/each}
      </Select.Content>
    </Select.Root>
  {/if}
</div>
