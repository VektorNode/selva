<script lang="ts">
	import type { DiscoveredInput, DiscoveredOutput, TabConfig } from '@selvajs/schemas';
	import { Button, Callout, Search, Select } from '@selvajs/ui';
	import { Layers, RefreshCw } from '@lucide/svelte';
	import type { GroupBy } from '$lib/utils/paramGrouping';
	import { usePersisted } from '$lib/composables/usePersisted.svelte';
	import AvailableItemList from '../AvailableItemList.svelte';
	import GhGroupImportDialog from '../GhGroupImportDialog.svelte';

	interface Props {
		tabs: TabConfig[];
		availableInputs: DiscoveredInput[];
		availableOutputs: DiscoveredOutput[];
		placedIds: Set<string>;
		syncNeeded: boolean;
		onSync: () => void;
		onAddToGroup: (
			tabId: string,
			groupId: string,
			item: DiscoveredInput | DiscoveredOutput
		) => void;
		onAddToNewGroup: (path: string, item: DiscoveredInput | DiscoveredOutput) => void;
		onImportGhGroups: (
			groupNames: string[],
			availableInputs: DiscoveredInput[],
			availableOutputs: DiscoveredOutput[],
			placedIds: Set<string>
		) => void;
	}

	let {
		tabs,
		availableInputs,
		availableOutputs,
		placedIds,
		syncNeeded,
		onSync,
		onAddToGroup,
		onAddToNewGroup,
		onImportGhGroups
	}: Props = $props();

	const GROUP_BY_LABELS: Record<GroupBy, string> = {
		none: 'No grouping',
		prefix: 'By prefix',
		type: 'By type',
		ghGroup: 'By GH group'
	};

	let query = $state('');
	const groupBy = usePersisted<GroupBy>('builder.params.groupBy', 'none');
	const types = usePersisted<string[]>('builder.params.types', []);
	let importDialogOpen = $state(false);

	const hasGhGroups = $derived(
		availableInputs.some((i) => !!i.groupName?.trim()) ||
			availableOutputs.some((o) => !!o.groupName?.trim())
	);

	const allTypes = $derived(
		Array.from(new Set([...availableInputs, ...availableOutputs].map((p): string => p.type))).sort()
	);

	// Drop persisted choices the current definition can't satisfy, or the list looks empty for no
	// visible reason.
	$effect(() => {
		if (!(groupBy.value in GROUP_BY_LABELS)) groupBy.value = 'none';
		if (groupBy.value === 'ghGroup' && !hasGhGroups) groupBy.value = 'none';
	});
	const activeTypes = $derived(types.value.filter((t) => allTypes.includes(t)));

	const typesLabel = $derived(
		activeTypes.length === 0
			? 'All types'
			: activeTypes.length === 1
				? activeTypes[0]
				: `${activeTypes.length} types`
	);
</script>

<div class="flex flex-col gap-3">
	{#if syncNeeded}
		<Callout tone="warning" title="Definition changed">
			<div class="flex flex-col items-start gap-2">
				<p>Grasshopper parameters changed since the last sync.</p>
				<Button size="sm" variant="outline" onclick={onSync}>
					<RefreshCw />
					Sync now
				</Button>
			</div>
		</Callout>
	{/if}

	<div class="flex flex-col gap-2">
		<Search bind:value={query} clearable placeholder="Search parameters" />
		<div class="grid grid-cols-2 gap-2">
			<Select.Root
				type="single"
				value={groupBy.value}
				onValueChange={(v) => (groupBy.value = v as GroupBy)}
			>
				<Select.Trigger size="sm" class="w-full" aria-label="Group parameters">
					{GROUP_BY_LABELS[groupBy.value]}
				</Select.Trigger>
				<Select.Content>
					{#each Object.entries(GROUP_BY_LABELS) as [value, label] (value)}
						{#if value !== 'ghGroup' || hasGhGroups}
							<Select.Item {value} {label} />
						{/if}
					{/each}
				</Select.Content>
			</Select.Root>
			<Select.Root type="multiple" bind:value={types.value}>
				<Select.Trigger size="sm" class="w-full" aria-label="Filter by type">
					{typesLabel}
				</Select.Trigger>
				<Select.Content>
					{#each allTypes as type (type)}
						<Select.Item value={type} label={type} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		{#if hasGhGroups}
			<Button variant="outline" size="sm" onclick={() => (importDialogOpen = true)}>
				<Layers />
				Add a Grasshopper group
			</Button>
		{/if}
	</div>

	<div class="flex flex-col">
		<AvailableItemList
			title="Inputs"
			items={availableInputs}
			{placedIds}
			{query}
			types={activeTypes}
			groupBy={groupBy.value}
			{tabs}
			{onAddToGroup}
			{onAddToNewGroup}
		/>
		<AvailableItemList
			title="Outputs"
			items={availableOutputs}
			{placedIds}
			{query}
			types={activeTypes}
			groupBy={groupBy.value}
			{tabs}
			{onAddToGroup}
			{onAddToNewGroup}
		/>
	</div>

	<p class="text-muted-foreground text-xs">
		Drag onto a group on the canvas, or right-click to pick a group.
	</p>
</div>

<GhGroupImportDialog
	open={importDialogOpen}
	{availableInputs}
	{availableOutputs}
	{placedIds}
	onOpenChange={(open) => (importDialogOpen = open)}
	onConfirm={(groupNames) =>
		onImportGhGroups(groupNames, availableInputs, availableOutputs, placedIds)}
/>
