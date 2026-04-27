<script lang="ts">
	import { Button, Drawer, Separator } from '@selvajs/ui';
	import { Play, X } from '@lucide/svelte';
	import type { DefinitionRecord } from '../+page.server';
	import StatusBadge from './StatusBadge.svelte';
	import { formatUpdated } from './statusStyles';

	interface Props {
		record: DefinitionRecord;
		projectName: string;
		onClose: () => void;
		onEdit: (record: DefinitionRecord) => void;
		onOpenRunner: (guid: string) => void;
	}

	let { record, projectName, onClose, onEdit, onOpenRunner }: Props = $props();
</script>

<Drawer {onClose}>
	<div class="border-border flex items-start justify-between gap-4 border-b p-6">
		<div class="min-w-0">
			<div class="flex items-center gap-2">
				<StatusBadge status={record.status} />
				<span class="text-muted-foreground font-mono text-[11px] tracking-wide uppercase">
					{projectName}
				</span>
			</div>
			<h2 class="mt-2.5 text-xl font-semibold tracking-tight">{record.displayName}</h2>
			{#if record.description}
				<p class="text-muted-foreground mt-1 text-sm">{record.description}</p>
			{/if}
		</div>
		<Button variant="ghost" size="icon" onclick={onClose} class="mt-0.5 h-8 w-8 shrink-0">
			<X class="h-4 w-4" />
		</Button>
	</div>

	<div class="flex-1 space-y-5 overflow-y-auto p-6">
		{#if record.coverImage}
			<img
				src={record.coverImage}
				alt={record.displayName}
				class="border-border aspect-4/3 w-full rounded-lg border object-cover"
			/>
		{:else}
			<div
				class="border-border bg-muted flex aspect-4/3 w-full items-center justify-center rounded-lg border"
			>
				<span class="text-muted-foreground font-mono text-[11px] tracking-widest uppercase">
					No preview
				</span>
			</div>
		{/if}

		<div class="flex gap-2">
			<Button class="flex-1" onclick={() => onOpenRunner(record.guid)}>
				<Play class="mr-1.5 h-3.5 w-3.5" /> Open runner
			</Button>
			<Button variant="outline" onclick={() => onEdit(record)}>Edit</Button>
		</div>

		<Separator />

		<div class="grid grid-cols-2 gap-4">
			<div>
				<p class="text-muted-foreground font-mono text-[10.5px] tracking-widest uppercase">
					Updated
				</p>
				<p class="mt-1 text-sm">{formatUpdated(record.updatedAt)} ago</p>
			</div>
			<div>
				<p class="text-muted-foreground font-mono text-[10.5px] tracking-widest uppercase">Runs</p>
				<p class="mt-1 text-sm">{record.solveCount.toLocaleString()}</p>
			</div>
			<div>
				<p class="text-muted-foreground font-mono text-[10.5px] tracking-widest uppercase">Live</p>
				<p class="text-muted-foreground mt-1 font-mono text-xs">
					{record.liveVersionId ? record.liveVersionId.slice(0, 8) : 'pending'}
				</p>
			</div>
			{#if record.category}
				<div>
					<p class="text-muted-foreground font-mono text-[10.5px] tracking-widest uppercase">
						Category
					</p>
					<p class="mt-1 text-sm">{record.category}</p>
				</div>
			{/if}
		</div>

		{#if record.tags?.length}
			<div>
				<Separator class="mb-4" />
				<p class="text-muted-foreground mb-2.5 font-mono text-[10.5px] tracking-widest uppercase">
					Tags
				</p>
				<div class="flex flex-wrap gap-1.5">
					{#each record.tags as tag (tag)}
						<span class="bg-muted text-muted-foreground rounded px-2 py-0.5 font-mono text-[11px]">
							#{tag}
						</span>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</Drawer>
