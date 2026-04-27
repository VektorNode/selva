<script lang="ts">
	import { Ellipsis } from '@lucide/svelte';
	import type { DefinitionRecord, ProjectWithMembers } from '../+page.server';
	import StatusBadge from './StatusBadge.svelte';
	import { formatUpdated } from './statusStyles';

	interface Props {
		records: DefinitionRecord[];
		projects: ProjectWithMembers[];
		onOpen: (record: DefinitionRecord) => void;
	}

	let { records, projects, onOpen }: Props = $props();

	const gridTemplate = 'grid-template-columns: 1.6fr 0.9fr 0.8fr 0.7fr 0.6fr 36px';

	function projectName(id: string) {
		return projects.find((p) => p.id === id)?.name ?? '';
	}
</script>

<div class="overflow-hidden rounded-xl border border-border bg-card">
	<div
		class="grid border-b border-border bg-muted/50 px-4 py-2.5 font-mono text-[10.5px] uppercase tracking-widest text-muted-foreground"
		style={gridTemplate}
	>
		<span>Definition</span><span>Project</span><span>Status</span><span>Updated</span>
		<span class="text-right">Runs</span><span></span>
	</div>
	{#each records as record, i (record.guid)}
		<div
			class={`grid items-center px-4 py-3.5 text-[13px] ${i < records.length - 1 ? 'border-b border-border' : ''}`}
			style={gridTemplate}
		>
			<span>
				<span class="font-semibold">{record.displayName}</span>
				{#if record.description}
					<span class="ml-2 text-[12px] text-muted-foreground">
						{record.description.slice(0, 60)}{record.description.length > 60 ? '…' : ''}
					</span>
				{/if}
			</span>
			<span class="text-muted-foreground">{projectName(record.projectId)}</span>
			<span><StatusBadge status={record.status} /></span>
			<span class="font-mono text-[12px] text-muted-foreground"
				>{formatUpdated(record.updatedAt)}</span
			>
			<span class="text-right font-mono text-[12px]">{record.solveCount.toLocaleString()}</span>
			<span class="flex justify-end">
				<button
					type="button"
					onclick={() => onOpen(record)}
					class="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
					aria-label="Open {record.displayName}"
				>
					<Ellipsis class="h-4 w-4" />
				</button>
			</span>
		</div>
	{/each}
</div>
