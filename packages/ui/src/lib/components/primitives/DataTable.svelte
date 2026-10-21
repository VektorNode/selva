<script lang="ts" module>
	export interface DataTableColumn {
		label: string;
		width?: string;
		align?: 'left' | 'right';
		/** Drop the column below 640px, where fixed widths would crush the flexible one. */
		hideOnMobile?: boolean;
	}
</script>

<script lang="ts" generics="T">
	import type { Snippet } from 'svelte';

	interface Props {
		rows: T[];
		columns: DataTableColumn[];
		getKey: (row: T) => string;
		row: Snippet<[T]>;
		class?: string;
	}

	let { rows, columns, getKey, row, class: className = '' }: Props = $props();

	// `minmax(0, …)` so a long name truncates rather than widening its row past the others.
	const toTemplate = (cols: DataTableColumn[]) =>
		cols.map((c) => c.width ?? 'minmax(0, 1fr)').join(' ');
	const gridTemplate = $derived(toTemplate(columns));
	const mobileTemplate = $derived(toTemplate(columns.filter((c) => !c.hideOnMobile)));
	// Cells come from the caller's snippet, so they're hidden by position.
	const hiddenCols = $derived(
		columns
			.map((c, i) => (c.hideOnMobile ? `hide-col-${i + 1}` : ''))
			.filter(Boolean)
			.join(' ')
	);
</script>

<div
	class={`divide-y rounded-lg border ${className}`}
	style:--table-cols={gridTemplate}
	style:--table-cols-sm={mobileTemplate}
>
	<div
		class="data-table-row gap-4 px-4 py-2 text-xs font-medium tracking-wide sm:grid-cols-(--table-cols) grid grid-cols-(--table-cols-sm) bg-muted/40 text-muted-foreground uppercase {hiddenCols}"
	>
		{#each columns as col (col.label)}
			<span class={col.align === 'right' ? 'text-right' : ''}>{col.label}</span>
		{/each}
	</div>
	{#each rows as item (getKey(item))}
		<div
			class="data-table-row gap-4 px-4 py-3 sm:grid-cols-(--table-cols) grid grid-cols-(--table-cols-sm) items-center {hiddenCols}"
		>
			{@render row(item)}
		</div>
	{/each}
</div>

<style>
	@media (max-width: 639px) {
		:global(.data-table-row.hide-col-1 > :nth-child(1)),
		:global(.data-table-row.hide-col-2 > :nth-child(2)),
		:global(.data-table-row.hide-col-3 > :nth-child(3)),
		:global(.data-table-row.hide-col-4 > :nth-child(4)),
		:global(.data-table-row.hide-col-5 > :nth-child(5)),
		:global(.data-table-row.hide-col-6 > :nth-child(6)),
		:global(.data-table-row.hide-col-7 > :nth-child(7)),
		:global(.data-table-row.hide-col-8 > :nth-child(8)) {
			display: none;
		}
	}
</style>
