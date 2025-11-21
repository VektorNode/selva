<script lang="ts">
  import type { BooleanInputType, DataTreeDefault } from '@computebuilder/core/grasshopper';
  import type { Snippet } from 'svelte';
  import BaseParam from './BaseParam.svelte';
  import * as Checkbox from '$lib/components/ui/checkbox/index.js';
  import Label from '$lib/components/ui/label/label.svelte';

  type Props = {
    input: BooleanInputType;
    value: boolean | boolean[] | DataTreeDefault<boolean>;
    showLabel?: boolean;
    customInput?: Snippet<
      [{ value: boolean; onUpdate: (val: boolean) => void; input: BooleanInputType; index: number }]
    >;
  };

  let { input, value = $bindable(), showLabel = false, customInput }: Props = $props();
</script>

<BaseParam bind:value name={input.name}>
  {#snippet children({ entry, onUpdate })}
    {#if customInput}
      {@render customInput({ value: entry.value, onUpdate, input, index: entry.index })}
    {:else}
      <div class="flex items-center gap-2">
        <Checkbox.Root
          checked={entry.value}
          onCheckedChange={(checked: boolean | 'indeterminate') => onUpdate(checked === true)}
        />
        {#if showLabel}
          <Label>
            {input.name}
            {entry.index > 0 ? entry.index + 1 : ''}
          </Label>
        {/if}
      </div>
    {/if}
  {/snippet}
</BaseParam>
