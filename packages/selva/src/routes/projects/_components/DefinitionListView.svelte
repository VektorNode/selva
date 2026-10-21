<script lang="ts">
	import { Ellipsis } from '@lucide/svelte';
	import type { DefinitionRecord, ProjectWithMembers } from '../+page.server';
	import StatusBadge from './StatusBadge.svelte';
	import { formatUpdated } from './statusStyles';
	import { huesFor, monogram } from '$lib/components/definitions/cardStyles';

	interface Props {
		records: DefinitionRecord[];
		projects: ProjectWithMembers[];
		onOpen: (record: DefinitionRecord) => void;
	}

	let { records, projects, onOpen }: Props = $props();

	// Phones drop project, updated and runs: at 390px the full row pushed the open button out of
	// the clipped card. `minmax(0, …)` lets long names truncate instead of widening the row.
	const gridTemplate =
		'grid-cols-[40px_minmax(0,1fr)_auto_36px] sm:grid-cols-[40px_minmax(0,1.6fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(0,0.6fr)_36px]';

	function projectName(id: string) {
		return projects.find((p) => p.id === id)?.name ?? '';
	}
</script>

<div class="border-border bg-card overflow-hidden rounded-xl border">
	<div
		class="border-border bg-muted/50 text-muted-foreground grid gap-4 border-b px-4 py-2.5 font-mono text-[10.5px] tracking-widest uppercase {gridTemplate}"
	>
		<span></span><span>Definition</span><span class="hidden sm:block">Project</span><span
			>Status</span
		><span class="hidden sm:block">Updated</span>
		<span class="hidden text-right sm:block">Runs</span><span></span>
	</div>
	{#each records as record, i (record.guid)}
		<div
			class={`grid items-center gap-4 px-4 py-3 text-[13px] ${gridTemplate} ${i < records.length - 1 ? 'border-border border-b' : ''}`}
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
			<span class="min-w-0 truncate sm:whitespace-normal">
				<span class="font-semibold">{record.displayName}</span>
				{#if record.description}
					<span class="text-muted-foreground ml-2 hidden text-[12px] sm:inline">
						{record.description.slice(0, 60)}{record.description.length > 60 ? '…' : ''}
					</span>
				{/if}
			</span>
			<span class="text-muted-foreground hidden truncate sm:block"
				>{projectName(record.projectId)}</span
			>
			<span><StatusBadge status={record.status} /></span>
			<span class="text-muted-foreground hidden font-mono text-[12px] sm:block"
				>{formatUpdated(record.updatedAt)}</span
			>
			<span class="hidden text-right font-mono text-[12px] sm:block"
				>{record.solveCount.toLocaleString()}</span
			>
			<span class="flex justify-end">
				<button
					type="button"
					onclick={() => onOpen(record)}
					class="text-muted-foreground hover:bg-muted hover:text-foreground rounded p-1 transition-colors pointer-coarse:p-2"
					aria-label="Open {record.displayName}"
				>
					<Ellipsis class="h-4 w-4" />
				</button>
			</span>
		</div>
	{/each}
</div>
