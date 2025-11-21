<script lang="ts">
  import type { DataTreeDefault, ValueListInputType } from '@computebuilder/core/grasshopper';
  import type { Snippet } from 'svelte';
  import BaseParam from './BaseParam.svelte';
  import * as Select from '$lib/components/ui/select/index.js';

  type Props = {
    input: ValueListInputType;
    value: string | string[] | DataTreeDefault<string>;
    customInput?: Snippet<
      [{ value: string; onUpdate: (val: string) => void; input: ValueListInputType }]
    >;
  };

  let { input, value = $bindable(), customInput }: Props = $props();

  // Convert values object to array of options for easier iteration
  const options = $derived(
    Object.entries(input.values).map(([label, val]) => ({
      label,
      value: val,
    }))
  );
</script>

<BaseParam bind:value name={input.name}>
  {#snippet children({ entry, onUpdate })}
    {#if customInput}
      {@render customInput({ value: entry.value, onUpdate, input })}
    {:else}
      {#snippet selectValue(props: any)}
        {options.find((o) => o.value === props.value)?.label ?? 'Select an option'}
      {/snippet}

      <Select.Root
        type="single"
        value={entry.value}
        onValueChange={(val: string | undefined) => {
          if (val) {
            onUpdate(val);
          }
        }}
      >
        <Select.Trigger class="w-full">
          {@render selectValue({ value: entry.value })}
        </Select.Trigger>
        <Select.Content>
          {#each options as option (option.value)}
            <Select.Item value={option.value} label={option.label}>
              {option.label}
            </Select.Item>
          {/each}
        </Select.Content>
      </Select.Root>
    {/if}
  {/snippet}
</BaseParam>
