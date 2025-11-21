<script lang="ts">
	import type { OutputLayoutItem } from '$lib/types/generated';
	import { Button } from '../ui';

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

	function formatValue(val: any): string {
		if (val === null || val === undefined) return '';

		if (typeof val === 'object') {
			return JSON.stringify(val, null, 2);
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
	<h3 class="flex items-center gap-2 text-sm font-medium text-foreground">
		{displayName || item.displayName || item.paramId}
	</h3>

	{#if isTextDisplay(item)}
		<div class="relative">
			<div
				class="overflow-wrap-anywhere min-h-[50px] rounded border border-border bg-muted px-3 py-3 font-mono text-sm wrap-break-word whitespace-pre-wrap text-foreground"
			>
				{#if value !== null && value !== undefined}
					{value}
				{:else}
					<span class="text-muted-foreground not-italic">Waiting for data...</span>
				{/if}
			</div>
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
	{/if}
</div>
