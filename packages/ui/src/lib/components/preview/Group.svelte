<script lang="ts">
	import type { LayoutItem, InputLayoutItem, OutputLayoutItem } from '@selvajs/schemas';
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/primitives/card';
	import { ChevronDown } from '@lucide/svelte';
	import { evaluateVisibility } from '$lib/schema/visibility-rules';

	interface Props {
		label: string;
		description?: string;
		items: LayoutItem[];
		columns: number;
		collapsed: boolean;
		values: Record<string, unknown>;
		onToggle: () => void;
		inputSnippet: Snippet<
			[
				layoutItem: InputLayoutItem,
				visibility: { visible: boolean; disabled: boolean; defaultValue?: unknown }
			]
		>;
		outputSnippet: Snippet<[layoutItem: OutputLayoutItem]>;
	}

	let {
		label,
		description,
		items,
		columns,
		collapsed,
		values,
		onToggle,
		inputSnippet,
		outputSnippet
	}: Props = $props();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onToggle();
		}
	}
</script>

<Card.Root class="gap-0 py-0 pt-0 overflow-hidden">
	<Card.Header
		class="pt-4 pb-4! cursor-pointer border-b border-border bg-muted transition-colors select-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
		role="button"
		tabindex={0}
		aria-expanded={!collapsed}
		onclick={onToggle}
		onkeydown={handleKeydown}
	>
		<Card.Title>{label}</Card.Title>
		{#if description}
			<Card.Description>{description}</Card.Description>
		{/if}
		<Card.Action>
			<ChevronDown
				class="h-4 w-4 text-muted-foreground transition-transform duration-200 {collapsed
					? ''
					: 'rotate-180'}"
			/>
		</Card.Action>
	</Card.Header>
	<div class="content-wrapper" class:collapsed>
		<div class="content-inner">
			<Card.Content class="p-6">
				<div class="schema-grid gap-6 grid" style="--schema-cols: {columns};">
					{#each items as layoutItem (layoutItem.type === 'linebreak' ? layoutItem.id : layoutItem.paramId)}
						{@render gridItem(layoutItem, columns)}
					{/each}
				</div>
			</Card.Content>
		</div>
	</div>
</Card.Root>

{#snippet gridItem(layoutItem: LayoutItem, cols: number)}
	{#if layoutItem.type === 'linebreak'}
		<div style="grid-column: 1 / -1" class="h-px bg-border" aria-hidden="true"></div>
	{:else}
		{@const visibility = evaluateVisibility(layoutItem, values)}
		{@const span = Math.min(Math.max(1, layoutItem.span ?? 1), cols)}
		{#if visibility.visible}
			{#if layoutItem.type === 'input'}
				<div
					class="min-w-0 flex items-center"
					class:opacity-50={visibility.disabled}
					style="grid-column: span {span} / span {span}"
				>
					{@render inputSnippet(layoutItem, visibility)}
				</div>
			{:else if layoutItem.type === 'output'}
				<div style="grid-column: span {span} / span {span}">
					{@render outputSnippet(layoutItem)}
				</div>
			{/if}
		{/if}
	{/if}
{/snippet}

<style>
	.content-wrapper {
		display: grid;
		grid-template-rows: 1fr;
		transition: grid-template-rows 0.3s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.content-wrapper.collapsed {
		grid-template-rows: 0fr;
	}

	.content-inner {
		min-height: 0;
	}

	.schema-grid {
		grid-template-columns: repeat(var(--schema-cols), minmax(0, 1fr));
	}
</style>
