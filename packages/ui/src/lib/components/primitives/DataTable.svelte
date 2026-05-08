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

<div class={`divide-y rounded-lg border ${className}`}>
	<div
		class="gap-4 px-4 py-2 text-xs font-medium tracking-wide grid bg-muted/40 text-muted-foreground uppercase"
		style:grid-template-columns={gridTemplate}
	>
		{#each columns as col (col.label)}
			<span class={col.align === 'right' ? 'text-right' : ''}>{col.label}</span>
		{/each}
	</div>
	{#each rows as item (getKey(item))}
		<div class="gap-4 px-4 py-3 grid items-center" style:grid-template-columns={gridTemplate}>
			{@render row(item)}
		</div>
	{/each}
</div>
