<script lang="ts">
  import type { Snippet } from 'svelte';
  import * as AccordionPrimitive from '$lib/components/ui/accordion/index.js';
  import { cn } from '$lib/utils.js';

  interface AccordionItem {
    id: string;
    title: string;
    disabled?: boolean;
  }

  interface Props {
    items: AccordionItem[];
    accordionChildren: Snippet<[AccordionItem]>;
    allowMultiple?: boolean;
    defaultOpen?: string[];
    className?: string;
    ontoggle?: (detail: { id: string; isOpen: boolean }) => void;
  }

  let {
    items,
    accordionChildren: children,
    allowMultiple = false,
    defaultOpen = [],
    className = '',
    ontoggle,
  }: Props = $props();

  // Initialize value based on type - string for single, array for multiple
  let value = $state<string | string[]>(allowMultiple ? defaultOpen : (defaultOpen[0] ?? ''));

  // Watch value changes to emit toggle events
  $effect(() => {
    if (ontoggle) {
      const openIds = Array.isArray(value) ? value : value ? [value] : [];
      // Notify for each item's state
      items.forEach((item) => {
        const isOpen = openIds.includes(item.id);
        ontoggle({ id: item.id, isOpen });
      });
    }
  });
</script>

{#if allowMultiple}
  <AccordionPrimitive.Root
    type="multiple"
    bind:value={value as string[]}
    class={cn('w-full', className)}
  >
    {#each items as item (item.id)}
      <AccordionPrimitive.Item value={item.id} disabled={item.disabled}>
        <AccordionPrimitive.Trigger>
          {item.title}
        </AccordionPrimitive.Trigger>
        <AccordionPrimitive.Content>
          {@render children(item)}
        </AccordionPrimitive.Content>
      </AccordionPrimitive.Item>
    {/each}
  </AccordionPrimitive.Root>
{:else}
  <AccordionPrimitive.Root
    type="single"
    bind:value={value as string}
    class={cn('w-full', className)}
  >
    {#each items as item (item.id)}
      <AccordionPrimitive.Item value={item.id} disabled={item.disabled}>
        <AccordionPrimitive.Trigger>
          {item.title}
        </AccordionPrimitive.Trigger>
        <AccordionPrimitive.Content>
          {@render children(item)}
        </AccordionPrimitive.Content>
      </AccordionPrimitive.Item>
    {/each}
  </AccordionPrimitive.Root>
{/if}
