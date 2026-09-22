<script lang="ts">
	import type { LayoutItem, InputLayoutItem, OutputLayoutItem } from '@selvajs/schemas';
	import type { Snippet } from 'svelte';
	import * as Card from '$lib/components/primitives/card';
	import { ChevronDown } from '@lucide/svelte';
	import { buildVisibilityMap, itemKey } from '$lib/schema/visibility-rules';

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
		/** When true, renders items flat without the Card wrapper, header, or collapse toggle. */
		flat?: boolean;
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
		outputSnippet,
		flat = false
	}: Props = $props();

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			onToggle();
		}
	}

	// One visibility evaluation per item per render; columnStarts and gridItem both read it.
	const visibilityMap = $derived(buildVisibilityMap(items, values));

	// Hidden items must not consume a slot here, because gridItem skips them entirely.
	// Counting them would offset every following item's column.
	const columnStarts = $derived.by(() => {
		const positions: number[] = [];
		let col = 0;
		for (const item of items) {
			if (item.type === 'linebreak') {
				positions.push(0);
				col = 0;
				continue;
			}
			const visibility = visibilityMap[itemKey(item)];
			if (!visibility.visible) {
				positions.push(0);
				continue;
			}
			const span = Math.min(Math.max(1, item.span ?? 1), columns);
			if (col + span > columns) col = 0;
			positions.push(col);
			col = (col + span) % columns;
		}
		return positions;
	});
</script>

{#if flat}
	<div class="p-6">
		<div class="schema-grid gap-6 grid" style="--schema-cols: {columns};">
			{#each items as layoutItem, i (layoutItem.type === 'linebreak' ? layoutItem.id : layoutItem.paramId)}
				{@render gridItem(layoutItem, columns, columnStarts[i] === 0)}
			{/each}
		</div>
	</div>
{:else}
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
						{#each items as layoutItem, i (layoutItem.type === 'linebreak' ? layoutItem.id : layoutItem.paramId)}
							{@render gridItem(layoutItem, columns, columnStarts[i] === 0)}
						{/each}
					</div>
				</Card.Content>
			</div>
		</div>
	</Card.Root>
{/if}

{#snippet gridItem(layoutItem: LayoutItem, cols: number, isFirstInRow: boolean)}
	{#if layoutItem.type === 'linebreak'}
		<div style="grid-column: 1 / -1" class="h-px bg-border" aria-hidden="true"></div>
	{:else}
		{@const visibility = visibilityMap[itemKey(layoutItem)]}
		{@const span = Math.min(Math.max(1, layoutItem.span ?? 1), cols)}
		{#if visibility.visible}
			{#if layoutItem.type === 'input'}
				<div
					class="grid-cell min-w-0 flex items-center"
					class:opacity-50={visibility.disabled}
					class:col-divider={!isFirstInRow && cols > 1}
					style="grid-column: span {span} / span {span}"
				>
					{@render inputSnippet(layoutItem, visibility)}
				</div>
			{:else if layoutItem.type === 'output'}
				<div
					class="grid-cell"
					class:col-divider={!isFirstInRow && cols > 1}
					style="grid-column: span {span} / span {span}"
				>
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

	/* Vertical divider painted in the column gap. `gap-6` is 24px, so a 12px
	   negative margin + 12px padding centres the 1px line in the gutter. */
	.col-divider {
		border-left: 1px solid var(--border);
		padding-left: 12px;
		margin-left: -12px;
	}

	/* When the container collapses the grid to 1 visual column, the items are
	   stacked and the divider would float on the left of every row. Hide it. */
	@container (max-width: 320px) {
		.col-divider {
			border-left: 0;
			padding-left: 0;
			margin-left: 0;
		}
	}
</style>
