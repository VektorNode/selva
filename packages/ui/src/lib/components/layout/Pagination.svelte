<script lang="ts">
	import { Button } from '../primitives';
	import { ChevronLeft, ChevronRight } from '@lucide/svelte';

	interface Props {
		/** Current 1-based page. Bindable. */
		page: number;
		total: number;
		perPage?: number;
		/** Plural noun for the range readout: "1–25 of 122 members". */
		label?: string;
		class?: string;
	}

	let {
		page = $bindable(1),
		total,
		perPage = 25,
		label = 'items',
		class: className = ''
	}: Props = $props();

	const pageCount = $derived(Math.max(1, Math.ceil(total / perPage)));

	// A filter can shrink `total` under the current page — clamp on read so the
	// list never renders an empty slice while the control still says "page 4".
	$effect(() => {
		if (page > pageCount) page = pageCount;
	});

	const first = $derived(total === 0 ? 0 : (page - 1) * perPage + 1);
	const last = $derived(Math.min(page * perPage, total));
</script>

{#if pageCount > 1}
	<div class={`gap-4 flex items-center justify-between ${className}`}>
		<p class="text-xs text-muted-foreground">
			{first}–{last} of {total}
			{label}
		</p>
		<div class="gap-1 flex items-center">
			<Button
				size="sm"
				variant="outline"
				disabled={page <= 1}
				onclick={() => (page -= 1)}
				aria-label="Previous page"
				class="h-8 w-8 p-0"
			>
				<ChevronLeft class="h-4 w-4" />
			</Button>
			<span class="px-2 font-mono text-xs text-muted-foreground">{page} / {pageCount}</span>
			<Button
				size="sm"
				variant="outline"
				disabled={page >= pageCount}
				onclick={() => (page += 1)}
				aria-label="Next page"
				class="h-8 w-8 p-0"
			>
				<ChevronRight class="h-4 w-4" />
			</Button>
		</div>
	</div>
{/if}
