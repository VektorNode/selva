<script lang="ts">
  import type { OutputLayoutItem } from '$lib/types/generated';
  import { Button } from '../ui';
  import FileDownloadWidget from './FileDownloadWidget.svelte';
  import * as Dialog from '$lib/components/ui/dialog';
  import { Info } from '@lucide/svelte';
  import { Label } from '$lib/components/ui/label';

  interface Props {
    item: OutputLayoutItem;
    value: any;
    displayName?: string;
  }

  let { item, value, displayName }: Props = $props();
  let copied = $state(false);

  function isTextDisplay(
    item: OutputLayoutItem
  ): item is Extract<OutputLayoutItem, { widgetType: 'text' }> {
    return item.widgetType === 'text';
  }

  function isNumberDisplay(
    item: OutputLayoutItem
  ): item is Extract<OutputLayoutItem, { widgetType: 'number' }> {
    return item.widgetType === 'number';
  }

  function isFileDisplay(
    item: OutputLayoutItem
  ): item is Extract<OutputLayoutItem, { widgetType: 'file' }> {
    return item.widgetType === 'file';
  }

  function formatValue(val: any): string {
    if (val === null || val === undefined) return '';

    if (typeof val === 'object') {
      try {
        return JSON.stringify(val, null, 2);
      } catch {
        return String(val);
      }
    }

    return String(val);
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
      setTimeout(() => {
        copied = false;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }
</script>

<div class="flex flex-col gap-2">
  <div class="flex items-center gap-2">
    <Label>
      {displayName || item.displayName || item.paramId}
    </Label>
    {#if item.description}
      <Dialog.Root>
        <Dialog.Trigger class="cursor-help opacity-60 transition-opacity hover:opacity-100">
          <button class="p-1">
            <Info size={16} />
          </button>
        </Dialog.Trigger>
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

  {#if isFileDisplay(item)}
    <FileDownloadWidget {displayName} fileData={value} />
  {:else if isNumberDisplay(item)}
    <div
      class="min-h-[50px] rounded border border-border bg-muted px-3 py-3 font-mono text-sm wrap-break-word"
    >
      {#if value !== null && value !== undefined}
        <span class="font-bold text-primary">{formatValue(value)}</span>
      {:else}
        <span class="text-muted-foreground not-italic">Waiting for data...</span>
      {/if}
    </div>
  {:else if isTextDisplay(item)}
    <div class="relative">
      {#if typeof value === 'object' && value !== null}
        <pre
          class="overflow-wrap-anywhere min-h-[50px] rounded border border-border bg-muted px-3 py-3 font-mono text-sm text-foreground overflow-auto max-h-96">{formatValue(
            value
          )}</pre>
      {:else}
        <div
          class="overflow-wrap-anywhere min-h-[50px] rounded border border-border bg-muted px-3 py-3 font-mono text-sm wrap-break-word whitespace-pre-wrap text-foreground"
        >
          {#if value !== null && value !== undefined}
            {value}
          {:else}
            <span class="text-muted-foreground not-italic">Waiting for data...</span>
          {/if}
        </div>
      {/if}
      {#if value !== null && value !== undefined}
        <Button
          onclick={() => copyToClipboard(formatValue(value))}
          class="absolute top-2 right-2 "
          size="sm"
        >
          {copied ? 'Copied!' : 'Copy'}
        </Button>
      {/if}
    </div>
  {/if}
</div>
