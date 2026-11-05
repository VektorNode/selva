<script lang="ts" module>
	export interface CanvasSelectedParam {
		id: string;
		label: string;
		/** Label of the group holding it in the draft, if placed. */
		placedIn?: string;
	}
</script>

<script lang="ts">
	import type { DiscoveredInput, DiscoveredOutput, TabConfig } from '@selvajs/schemas';
	import { Button, Callout, Search, Select } from '@selvajs/ui';
	import { Layers, RefreshCw, SlidersHorizontal } from '@lucide/svelte';
	import type { GroupBy } from '#lib/utils/paramGrouping.js';
	import { usePersisted } from '#lib/composables/usePersisted.svelte.js';
	import AvailableItemList from '../AvailableItemList.svelte';
	import GhGroupImportDialog from '../GhGroupImportDialog.svelte';

	interface Props {
		tabs: TabConfig[];
		/** Params selected on the Grasshopper canvas, in canvas order. */
		canvasSelection: CanvasSelectedParam[];
		availableInputs: DiscoveredInput[];
		availableOutputs: DiscoveredOutput[];
		placedIds: Set<string>;
		syncNeeded: boolean;
		onSync: () => void;
		/** Opens the sync preview; unlike `onSync`, available whether or not a change was detected. */
		onSyncPreview: () => void;
		/** Opens the batch processors dialog. */
		onBatch: () => void;
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
		canvasSelection,
		availableInputs,
		availableOutputs,
		placedIds,
		syncNeeded,
		onSync,
		onSyncPreview,
		onBatch,
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

	// Ignore persisted choices this definition can't satisfy, or the list looks empty for no
	// visible reason. Never write the fallback back: the preference is shared by every definition.
	const activeGroupBy = $derived.by((): GroupBy => {
		if (!Object.hasOwn(GROUP_BY_LABELS, groupBy.value)) return 'none';
		if (groupBy.value === 'ghGroup' && !hasGhGroups) return 'none';
		return groupBy.value;
	});
	const activeTypes = $derived(types.value.filter((t) => allTypes.includes(t)));

	const typesLabel = $derived(
		activeTypes.length === 0
			? 'All types'
			: activeTypes.length === 1
				? activeTypes[0]
				: `${activeTypes.length} types`
	);

	/** Narrows the list to one parameter, dropping any type filter that would hide it. */
	export function showParameter(nickname: string) {
		query = nickname;
		types.value = [];
	}
</script>

<div class="flex flex-col gap-6">
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

	<div class="grid grid-cols-2 gap-2">
		<Button variant="outline" size="sm" onclick={onSyncPreview}>
			<RefreshCw />
			<span class="truncate">Sync</span>
		</Button>
		<Button variant="outline" size="sm" onclick={onBatch}>
			<SlidersHorizontal />
			<span class="truncate">Batch</span>
		</Button>
	</div>

	<div class="flex flex-col gap-2">
		<Search bind:value={query} clearable placeholder="Search parameters" />
		<div class="grid grid-cols-2 gap-2">
			<Select.Root
				type="single"
				value={activeGroupBy}
				onValueChange={(v) => (groupBy.value = v as GroupBy)}
			>
				<Select.Trigger size="sm" class="w-full" aria-label="Group parameters">
					<span class="truncate">{GROUP_BY_LABELS[activeGroupBy]}</span>
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
					<span class="truncate">{typesLabel}</span>
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
				<span class="truncate">Add a Grasshopper group</span>
			</Button>
		{/if}
	</div>

	{#if canvasSelection.length > 0}
		<section aria-label="Selected on canvas" class="bg-muted flex flex-col gap-2 rounded-md p-3">
			<p class="text-muted-foreground text-xs font-medium">
				{canvasSelection.length} selected on canvas
			</p>
			<ul class="flex flex-wrap gap-2">
				{#each canvasSelection as param (param.id)}
					<li class="bg-raised shadow-raised text-foreground rounded-sm border px-2 py-0.5 text-xs">
						{param.label}{#if param.placedIn}<span class="text-muted-foreground">
								· in {param.placedIn}</span
							>{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	<div class="flex flex-col gap-3">
		<AvailableItemList
			id="inputs"
			title="Inputs"
			items={availableInputs}
			{placedIds}
			{query}
			types={activeTypes}
			groupBy={activeGroupBy}
			{tabs}
			{onAddToGroup}
			{onAddToNewGroup}
		/>
		<AvailableItemList
			id="outputs"
			title="Outputs"
			items={availableOutputs}
			{placedIds}
			{query}
			types={activeTypes}
			groupBy={activeGroupBy}
			{tabs}
			{onAddToGroup}
			{onAddToNewGroup}
		/>
	</div>
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
