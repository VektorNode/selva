<script lang="ts">
	import { Button, Drawer, Separator, Tabs } from '@selvajs/shared';
	import { Play, X } from '@lucide/svelte';
	import type { DefinitionRecord } from '../+page.server';
	import StatusBadge from './StatusBadge.svelte';
	import { formatUpdated } from './statusStyles';
	import ShareLinkSection from './ShareLinkSection.svelte';

	interface Props {
		record: DefinitionRecord;
		projectName: string;
		onClose: () => void;
		onEdit: (record: DefinitionRecord) => void;
		onOpenRunner: (guid: string) => void;
	}

	let { record, projectName, onClose, onEdit, onOpenRunner }: Props = $props();

	let activeTab = $state<'details' | 'shares'>('details');
</script>

<Drawer {onClose}>
	<div class="flex items-start justify-between gap-4 border-b border-border p-6">
		<div class="min-w-0">
			<div class="flex items-center gap-2">
				<StatusBadge status={record.status} />
				<span class="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
					{projectName}
				</span>
			</div>
			<h2 class="mt-2.5 text-xl font-semibold tracking-tight">{record.displayName}</h2>
			{#if record.description}
				<p class="mt-1 text-sm text-muted-foreground">{record.description}</p>
			{/if}
		</div>
		<Button variant="ghost" size="icon" onclick={onClose} class="mt-0.5 h-8 w-8 shrink-0">
			<X class="h-4 w-4" />
		</Button>
	</div>

	<div class="flex gap-2 border-b border-border px-6 py-3">
		<Button class="flex-1" onclick={() => onOpenRunner(record.guid)}>
			<Play class="mr-1.5 h-3.5 w-3.5" /> Open runner
		</Button>
		<Button variant="outline" onclick={() => onEdit(record)}>Edit</Button>
	</div>

	<Tabs.Root bind:value={activeTab} class="flex-1 overflow-hidden flex flex-col">
		<Tabs.List class="mx-6 mt-4 grid w-auto grid-cols-2">
			<Tabs.Trigger value="details">Details</Tabs.Trigger>
			<Tabs.Trigger value="shares">Share links</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="details" class="flex-1 overflow-y-auto px-6 py-5 space-y-5 mt-0">
			{#if record.coverImage}
				<img
					src={record.coverImage}
					alt={record.displayName}
					class="aspect-4/3 w-full rounded-lg border border-border object-cover"
				/>
			{:else}
				<div
					class="flex aspect-4/3 w-full items-center justify-center rounded-lg border border-border bg-muted"
				>
					<span class="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
						No preview
					</span>
				</div>
			{/if}

			<div class="grid grid-cols-2 gap-4">
				<div>
					<p class="font-mono text-[10.5px] uppercase tracking-widest text-muted-foreground">
						Updated
					</p>
					<p class="mt-1 text-sm">{formatUpdated(record.updatedAt)} ago</p>
				</div>
				<div>
					<p class="font-mono text-[10.5px] uppercase tracking-widest text-muted-foreground">
						Runs
					</p>
					<p class="mt-1 text-sm">{record.runCount.toLocaleString()}</p>
				</div>
				<div>
					<p class="font-mono text-[10.5px] uppercase tracking-widest text-muted-foreground">
						Live
					</p>
					<p class="mt-1 font-mono text-xs text-muted-foreground">
						{record.liveVersionId ? record.liveVersionId.slice(0, 8) : 'pending'}
					</p>
				</div>
				{#if record.category}
					<div>
						<p class="font-mono text-[10.5px] uppercase tracking-widest text-muted-foreground">
							Category
						</p>
						<p class="mt-1 text-sm">{record.category}</p>
					</div>
				{/if}
			</div>

			{#if record.tags?.length}
				<div>
					<Separator class="mb-4" />
					<p class="mb-2.5 font-mono text-[10.5px] uppercase tracking-widest text-muted-foreground">
						Tags
					</p>
					<div class="flex flex-wrap gap-1.5">
						{#each record.tags as tag (tag)}
							<span
								class="rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
							>
								#{tag}
							</span>
						{/each}
					</div>
				</div>
			{/if}
		</Tabs.Content>

		<Tabs.Content value="shares" class="flex-1 overflow-y-auto px-6 py-5 mt-0">
			<ShareLinkSection definitionGuid={record.guid} />
		</Tabs.Content>
	</Tabs.Root>
</Drawer>
