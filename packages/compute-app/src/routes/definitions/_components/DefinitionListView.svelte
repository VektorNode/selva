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

<div class="border-border bg-card overflow-hidden rounded-xl border">
	<div
		class="border-border bg-muted/50 text-muted-foreground grid border-b px-4 py-2.5 font-mono text-[10.5px] tracking-widest uppercase"
		style={gridTemplate}
	>
		<span>Definition</span><span>Project</span><span>Status</span><span>Updated</span>
		<span class="text-right">Runs</span><span></span>
	</div>
	{#each records as record, i (record.guid)}
		<button
			onclick={() => onOpen(record)}
			class="hover:bg-muted/50 grid w-full items-center px-4 py-3.5 text-left text-[13px] transition-colors
				{i < records.length - 1 ? 'border-border border-b' : ''}"
			style={gridTemplate}
		>
			<span>
				<span class="font-semibold">{record.displayName}</span>
				{#if record.description}
					<span class="text-muted-foreground ml-2 text-[12px]">
						{record.description.slice(0, 60)}{record.description.length > 60 ? '…' : ''}
					</span>
				{/if}
			</span>
			<span class="text-muted-foreground">{projectName(record.projectId)}</span>
			<span><StatusBadge status={record.status} /></span>
			<span class="text-muted-foreground font-mono text-[12px]"
				>{formatUpdated(record.updatedAt)}</span
			>
			<span class="text-right font-mono text-[12px]">{record.runCount.toLocaleString()}</span>
			<span class="flex justify-end"><Ellipsis class="text-muted-foreground h-4 w-4" /></span>
		</button>
	{/each}
</div>
