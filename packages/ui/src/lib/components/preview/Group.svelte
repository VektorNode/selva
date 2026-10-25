<script lang="ts">
	import type { LayoutItem, InputLayoutItem, OutputLayoutItem } from '@selvajs/schemas';
	import type { Snippet } from 'svelte';
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
		/** When true, renders items without the header or collapse toggle. */
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

	const visibilityMap = $derived(buildVisibilityMap(items, values));

	const uid = $props.id();
	const descriptionId = `${uid}-description`;

	// Below this a label and its control stop fitting side by side, so a wide group
	// sheds columns as its panel narrows instead of squeezing every input.
	const MIN_COLUMN_WIDTH = 160;
	const COLUMN_GAP = 16;

	let gridWidth = $state(0);
	const effectiveColumns = $derived(
		gridWidth === 0
			? columns
			: Math.max(
					1,
					Math.min(columns, Math.floor((gridWidth + COLUMN_GAP) / (MIN_COLUMN_WIDTH + COLUMN_GAP)))
				)
	);
</script>

{#snippet grid()}
	<div
		class="schema-grid"
		style="--schema-cols: {effectiveColumns}; --column-gap: {COLUMN_GAP}px;"
		bind:clientWidth={gridWidth}
	>
		{#each items as layoutItem (layoutItem.type === 'linebreak' ? layoutItem.id : layoutItem.paramId)}
			{@render gridItem(layoutItem)}
		{/each}
	</div>
{/snippet}

<section class="shadow-xs rounded-xl border bg-card">
	{#if flat}
		<div class="p-4">
			{@render grid()}
		</div>
	{:else}
		<!-- The host's page owns the h1 and the panel holds the h2. The description sits outside the
		     heading's button, so the heading and the button are named by the label alone. -->
		<h3>
			<button
				type="button"
				class="gap-3 px-4 pt-3.5 flex w-full items-start text-left outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset {description
					? 'pb-0'
					: 'pb-3.5'}"
				aria-expanded={!collapsed}
				aria-describedby={description ? descriptionId : undefined}
				onclick={onToggle}
			>
				<span class="min-w-0 text-base font-semibold leading-snug flex-1 text-foreground"
					>{label}</span
				>
				<ChevronDown
					class="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 {collapsed
						? '-rotate-90'
						: ''}"
				/>
			</button>
		</h3>
		{#if description}
			<p
				id={descriptionId}
				class="pl-4 pr-11 pt-0.5 pb-3.5 text-xs leading-snug text-muted-foreground"
			>
				{description}
			</p>
		{/if}
		<div class="content-wrapper" class:collapsed inert={collapsed}>
			<div class="content-inner">
				<div class="px-4 pt-1 pb-5">
					{@render grid()}
				</div>
			</div>
		</div>
	{/if}
</section>

{#snippet gridItem(layoutItem: LayoutItem)}
	{#if layoutItem.type === 'linebreak'}
		<div class="grid-break" aria-hidden="true"></div>
	{:else}
		{@const visibility = visibilityMap[itemKey(layoutItem)]}
		{@const span = Math.min(Math.max(1, layoutItem.span ?? 1), effectiveColumns)}
		{#if visibility.visible}
			<div class="grid-cell min-w-0" class:opacity-50={visibility.disabled} style="--span: {span}">
				{#if layoutItem.type === 'input'}
					{@render inputSnippet(layoutItem, visibility)}
				{:else if layoutItem.type === 'output'}
					{@render outputSnippet(layoutItem)}
				{/if}
			</div>
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
		overflow: hidden;
	}

	.schema-grid {
		display: grid;
		grid-template-columns: repeat(var(--schema-cols), minmax(0, 1fr));
		gap: 1rem var(--column-gap);
		align-items: start;
	}

	.grid-cell {
		grid-column: span var(--span) / span var(--span);
	}

	/* An empty full-width row: the two row gaps around it already read as a break. */
	.grid-break {
		grid-column: 1 / -1;
		margin-block: -0.25rem;
	}
</style>
