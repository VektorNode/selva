<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import type { DefinitionRecord } from '@selvajs/platform';
	import StarButton from './StarButton.svelte';
	import { huesFor, monogram } from '#lib/components/definitions/cardStyles.js';

	interface Props {
		records: DefinitionRecord[];
		starredIds: Set<string>;
		loadingGuid: string | null;
		starBusyGuid: string | null;
		onOpen: (guid: string) => void;
		onToggleStar: (guid: string) => void;
	}

	let { records, starredIds, loadingGuid, starBusyGuid, onOpen, onToggleStar }: Props = $props();

	// Phones drop tags and run count so the name keeps a readable width.
	const gridTemplate =
		'grid-cols-[40px_minmax(0,1fr)_auto] sm:grid-cols-[40px_minmax(0,1.7fr)_minmax(0,1fr)_90px_36px]';
</script>

<div class="border-border bg-card overflow-hidden rounded-xl border">
	{#each records as record, i (record.guid)}
		<button
			type="button"
			onclick={() => onOpen(record.guid)}
			disabled={loadingGuid === record.guid}
			class="hover:bg-muted/40 group grid w-full items-center gap-4 px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60
				{gridTemplate} {i < records.length - 1 ? 'border-border border-b' : ''}"
		>
			{#if record.coverImage}
				<div class="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md">
					<img src={record.coverImage} alt="" class="h-full w-full object-cover" />
				</div>
			{:else}
				{@const hues = huesFor(record.guid)}
				<div
					class="tool-cover-fallback flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md"
					style:--tool-h1={hues.h1}
					style:--tool-h2={hues.h2}
				>
					<span class="text-foreground/40 text-base font-semibold">
						{monogram(record.displayName)}
					</span>
				</div>
			{/if}

			<div class="min-w-0">
				<p class="truncate text-[13.5px] font-semibold">{record.displayName}</p>
				{#if record.description}
					<p class="text-muted-foreground truncate text-[12px]">
						{record.description}
					</p>
				{/if}
			</div>

			<div class="hidden flex-wrap items-center gap-1 sm:flex">
				{#if record.tags?.length}
					{#each record.tags.slice(0, 3) as tag (tag)}
						<span
							class="bg-muted text-muted-foreground rounded px-1.5 py-px font-mono text-[10.5px]"
							>#{tag}</span
						>
					{/each}
				{/if}
			</div>

			<span class="text-muted-foreground hidden font-mono text-[12px] sm:inline">
				{record.solveCount > 0 ? `${record.solveCount.toLocaleString()} runs` : '—'}
			</span>

			<div class="flex items-center justify-end gap-1">
				<StarButton
					starred={starredIds.has(record.guid)}
					busy={starBusyGuid === record.guid}
					variant="chip"
					onToggle={() => onToggleStar(record.guid)}
				/>
				<ArrowRight
					class="text-muted-foreground h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100 pointer-coarse:opacity-100"
				/>
			</div>
		</button>
	{/each}
</div>
