<script lang="ts">
  import type { DataTreeDefault, NumericInputType } from '@computebuilder/core/grasshopper';
  import type { Snippet } from 'svelte';
  import BaseParam from './BaseParam.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import * as Slider from '$lib/components/ui/slider/index.js';
  import { validateNumber, getSliderConfig } from '../../utils/validation.js';
  import { cn } from '$lib/utils.js';

  type Props = {
    input: NumericInputType;
    value: number | number[] | DataTreeDefault<number>;
    showSlider?: boolean;
    showRange?: boolean;
    class?: string;
    customInput?: Snippet<
      [
        {
          value: number;
          onUpdate: (val: number) => void;
          input: NumericInputType;
          validation?: { isValid: boolean; warning: string };
        },
      ]
    >;
  };

  let {
    input,
    value = $bindable(),
    showSlider = false,
    showRange = true,
    class: className,
    customInput,
  }: Props = $props();

  // Slider configuration
  const sliderConfig = $derived(getSliderConfig(input));
  const hasMinMax = $derived(input.minimum != null && input.maximum != null);

  // Local state for validation tracking per input
  let validationState = $state<Record<string, { isValid: boolean; warning: string }>>({});

  // Generate unique key for validation tracking
  function getKey(index: number, branch?: string): string {
    return branch ? `${branch}-${index}` : `${index}`;
  }

  // Handle input changes (soft validation + immediate update for valid values)
  function handleInput(onUpdate: (val: number) => void, key: string, e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    const result = validateNumber(target.value, input);

    validationState[key] = {
      isValid: result.isValid,
      warning: result.warningMessage,
    };

    // Update value immediately if it's valid (for slider sync)
    if (result.isValid) {
      const numValue = parseFloat(target.value);
      if (!isNaN(numValue)) {
        onUpdate(numValue);
      }
    }
  }

  // Handle blur (hard validation - apply clamping for invalid values)
  function handleBlur(onUpdate: (val: number) => void, key: string, e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    const result = validateNumber(target.value, input);

    if (!result.isValid) {
      onUpdate(result.clampedValue);
      target.value = result.clampedValue.toString();
    }

    // Clear validation state after applying
    delete validationState[key];
  }
</script>

<BaseParam bind:value name={input.name}>
  {#snippet children({ entry, onUpdate })}
    {@const key = getKey(entry.index, entry.branch)}
    {@const validation = validationState[key]}

    {#if customInput}
      {@render customInput({ value: entry.value, onUpdate, input, validation })}
    {:else}
      <div class="space-y-2">
        {#if showSlider && hasMinMax}
          <div class="space-y-1">
            <Slider.Root
              type="single"
              value={entry.value}
              min={sliderConfig.min}
              max={sliderConfig.max}
              step={sliderConfig.step}
              onValueChange={(value: number) => onUpdate(value)}
              class="w-full"
            />
            <div class="flex justify-between text-xs text-muted-foreground">
              <span>{sliderConfig.min}</span>
              <span class="font-medium text-foreground">{entry.value}</span>
              <span>{sliderConfig.max}</span>
            </div>
          </div>
        {/if}

        <Input
          type="number"
          value={entry.value}
          step={sliderConfig.step}
          min={input.minimum ?? undefined}
          max={input.maximum ?? undefined}
          oninput={(e) => handleInput(onUpdate, key, e)}
          onblur={(e) => handleBlur(onUpdate, key, e)}
          placeholder={input.description}
          class={cn('w-full', className)}
          aria-invalid={validation?.isValid === false}
        />

        {#if validation && !validation.isValid}
          <div class="text-xs text-yellow-600 dark:text-yellow-400">
            {validation.warning}
          </div>
        {/if}

        {#if hasMinMax && showRange}
          <div class="text-xs text-muted-foreground">
            Range: {input.minimum ?? '−∞'} to {input.maximum ?? '∞'}
          </div>
        {/if}
      </div>
    {/if}
  {/snippet}
</BaseParam>
