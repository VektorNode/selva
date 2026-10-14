<script lang="ts" module>
	export interface DataTableColumn {
		label: string;
		width?: string;
		align?: 'left' | 'right';
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

	const gridTemplate = $derived(columns.map((c) => c.width ?? '1fr').join(' '));
</script>

<div class={`divide-y rounded-lg border ${className}`} style:--table-cols={gridTemplate}>
	<div
		class="gap-4 px-4 py-2 text-xs font-medium tracking-wide grid grid-cols-(--table-cols) bg-muted/40 text-muted-foreground uppercase"
	>
		{#each columns as col (col.label)}
			<span class={col.align === 'right' ? 'text-right' : ''}>{col.label}</span>
		{/each}
	</div>
	{#each rows as item (getKey(item))}
		<div class="gap-4 px-4 py-3 grid grid-cols-(--table-cols) items-center">
			{@render row(item)}
		</div>
	{/each}
</div>
