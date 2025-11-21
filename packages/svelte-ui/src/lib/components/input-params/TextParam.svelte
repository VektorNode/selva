<script lang="ts">
  import type { DataTreeDefault, TextInputType } from 'rhino-compute-core/grasshopper';
  import type { Snippet } from 'svelte';
  import BaseParam from './BaseParam.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import { cn } from '$lib/utils.js';

  type Props = {
    input: TextInputType;
    value: string | string[] | DataTreeDefault<string>;
    maxLength?: number;
    class?: string;
    customInput?: Snippet<
      [{ value: string; onUpdate: (val: string) => void; input: TextInputType }]
    >;
  };

  let { input, value = $bindable(), maxLength, class: className, customInput }: Props = $props();

  // Determine max length from input properties or prop
  const computedMaxLength = $derived(maxLength ?? (input.name === 'Prefix' ? 5 : 100));
</script>

<BaseParam bind:value name={input.name}>
  {#snippet children({ entry, onUpdate })}
    {#if customInput}
      {@render customInput({ value: entry.value, onUpdate, input })}
    {:else}
      <Input
        type="text"
        value={entry.value}
        oninput={(e) => onUpdate(e.currentTarget.value)}
        maxlength={computedMaxLength}
        placeholder={input.description}
        class={cn('w-full', className)}
      />
    {/if}
  {/snippet}
</BaseParam>
