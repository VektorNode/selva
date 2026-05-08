<script lang="ts">
	import type {
		DiscoveredInput,
		DiscoveredOutput,
		GrasshopperParamType,
		TabConfig
	} from '@selvajs/schemas';
	import { StateDisplay, Input, Badge, Select, Collapsible } from '@selvajs/ui';
	import DraggableItem from './DraggableItem.svelte';
	import { Search, X, ChevronDown } from '@lucide/svelte';
	import { getSessionIdFromUrl } from '$lib/utils/session';
	import { clusterItems, type GroupBy, type GroupedItem } from '$lib/utils/paramGrouping';
	import { SvelteSet } from 'svelte/reactivity';
	import { dndzone } from 'svelte-dnd-action';
	import { DND_TYPE_PARAM } from '$lib/dnd/dndzone-helpers';

	interface AvailableItemListProps {
		items: GroupedItem[];
		title: string;
		placedIds?: string[];
		emptyMessage?: string;
		tabs?: TabConfig[];
		onAddToGroup?: (
			tabId: string,
			groupId: string,
			item: DiscoveredInput | DiscoveredOutput
		) => void;
		onAddToNewGroup?: (path: string, item: DiscoveredInput | DiscoveredOutput) => void;
	}

	let {
		items,
		title,
		placedIds = [],
		emptyMessage = 'No items found.',
		tabs = [],
		onAddToGroup,
		onAddToNewGroup
	}: AvailableItemListProps = $props();

	let searchQuery = $state('');
	const selectedTypes = new SvelteSet<GrasshopperParamType | string>();

	const sessionId = $derived(getSessionIdFromUrl());

	const sectionStorageKey = $derived(`builder.availableSection.open:${sessionId}:${title}`);
	const toolbarStorageKey = $derived(`builder.availableToolbar:${sessionId}:${title}`);

	let sectionOpen = $state(true);
	let groupBy = $state<GroupBy>('none');

	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		const stored = localStorage.getItem(sectionStorageKey);
		if (stored !== null) sectionOpen = stored === '1';
	});

	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(sectionStorageKey, sectionOpen ? '1' : '0');
	});

	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		const stored = localStorage.getItem(toolbarStorageKey);
		if (!stored) return;
		try {
			const parsed = JSON.parse(stored) as {
				groupBy?: GroupBy;
				selectedTypes?: string[];
			};
			if (
				parsed.groupBy === 'none' ||
				parsed.groupBy === 'prefix' ||
				parsed.groupBy === 'type' ||
				parsed.groupBy === 'ghGroup'
			) {
				groupBy = parsed.groupBy;
			}
			if (Array.isArray(parsed.selectedTypes)) {
				selectedTypes.clear();
				for (const t of parsed.selectedTypes) selectedTypes.add(t);
			}
		} catch {
			// ignore corrupt state
		}
	});

	$effect(() => {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(
			toolbarStorageKey,
			JSON.stringify({
				groupBy,
				selectedTypes: Array.from(selectedTypes)
			})
		);
	});

	const placedSet = $derived(new Set(placedIds));

	const baseItems = $derived(items.filter((i) => !placedSet.has(i.id)));

	const availableTypes = $derived(Array.from(new Set(items.map((item) => item.type))).sort());

	const hasGhGroups = $derived(items.some((item) => !!item.groupName?.trim()));

	$effect(() => {
		// If the persisted choice is ghGroup but no items have a group, fall back to none
		if (groupBy === 'ghGroup' && !hasGhGroups) groupBy = 'none';
	});

	const filteredItems = $derived.by(() => {
		let filtered = baseItems;

		if (searchQuery.trim()) {
			const query = searchQuery.toLowerCase();
			filtered = filtered.filter((item) => {
				const nickname = item.nickname?.toLowerCase() || '';
				const description = 'description' in item ? item.description?.toLowerCase() || '' : '';
				return nickname.includes(query) || description.includes(query);
			});
		}

		if (selectedTypes.size > 0) {
			filtered = filtered.filter((item) => selectedTypes.has(item.type));
		}

		return filtered;
	});

	const clusters = $derived(clusterItems(filteredItems, groupBy));

	const headerCount = $derived(baseItems.length);

	// Per-cluster local mirror so dndzone can mutate visually without
	// touching the upstream catalog. Source zones are read-only — once a
	// drop completes, `placedSet` recomputes and `clusters` re-derives,
	// overriding any in-flight mutation.
	let localClusterItems = $state<Record<string, GroupedItem[]>>({});
	let isDragging = $state(false);

	$effect(() => {
		if (isDragging) return;
		const next: Record<string, GroupedItem[]> = {};
		for (const c of clusters) next[c.key] = [...c.items];
		localClusterItems = next;
	});

	function clusterItemsFor(key: string, fallback: GroupedItem[]): GroupedItem[] {
		return localClusterItems[key] ?? fallback;
	}

	function handleClusterConsider(key: string, e: CustomEvent<{ items: GroupedItem[] }>) {
		isDragging = true;
		localClusterItems = { ...localClusterItems, [key]: e.detail.items };
	}

	function handleClusterFinalize(key: string, e: CustomEvent<{ items: GroupedItem[] }>) {
		isDragging = false;
		// Source is read-only: discard dndzone's mutated items and resync from
		// the current cluster (the destination's commit will have updated
		// placedSet, which re-derives the cluster).
		const current = clusters.find((c) => c.key === key);
		localClusterItems = { ...localClusterItems, [key]: current ? [...current.items] : e.detail.items };
	}

	function toggleType(type: string) {
		if (selectedTypes.has(type)) selectedTypes.delete(type);
		else selectedTypes.add(type);
	}

	function clearTypeFilter() {
		selectedTypes.clear();
	}

	function clearSearch() {
		searchQuery = '';
	}

	const clusterStateKey = $derived(`builder.cluster.open:${sessionId}:${title}:${groupBy}`);
	let clusterOpen = $state<Record<string, boolean>>({});

	$effect(() => {
		const key = clusterStateKey;
		if (typeof localStorage === 'undefined') {
			clusterOpen = {};
			return;
		}
		const stored = localStorage.getItem(key);
		if (!stored) {
			clusterOpen = {};
			return;
		}
		try {
			clusterOpen = JSON.parse(stored) as Record<string, boolean>;
		} catch {
			clusterOpen = {};
		}
	});

	function setClusterOpen(key: string, open: boolean) {
		clusterOpen = { ...clusterOpen, [key]: open };
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(clusterStateKey, JSON.stringify(clusterOpen));
	}

	function isClusterOpen(key: string): boolean {
		return clusterOpen[key] ?? true;
	}
</script>

<Collapsible.Root bind:open={sectionOpen} class="mb-6">
	<Collapsible.Trigger
		class="bg-card hover:bg-accent/40 sticky top-0 z-10 -mx-1 mb-3 flex w-[calc(100%+0.5rem)] items-center justify-between gap-2 rounded px-1 py-2 text-left transition-colors"
	>
		<h3 class="text-foreground flex items-center gap-2 text-base font-semibold">
			{title} ({headerCount})
		</h3>
		<ChevronDown
			size={14}
			class="text-muted-foreground transition-transform duration-200 {sectionOpen
				? 'rotate-180'
				: ''}"
		/>
	</Collapsible.Trigger>

	<Collapsible.Content>
		{#if items.length > 0}
			<div class="mb-3 flex flex-col gap-2">
				<div class="relative">
					<Search class="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
					<Input
						type="text"
						placeholder="Search by name or description..."
						bind:value={searchQuery}
						class="pr-9 pl-9"
					/>
					{#if searchQuery}
						<button
							type="button"
							onclick={clearSearch}
							class="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2"
							aria-label="Clear search"
						>
							<X class="size-4" />
						</button>
					{/if}
				</div>

				<Select.Root
					type="single"
					value={groupBy}
					onValueChange={(value) => {
						if (
							value === 'none' ||
							value === 'prefix' ||
							value === 'type' ||
							value === 'ghGroup'
						) {
							groupBy = value;
						}
					}}
				>
					<Select.Trigger class="h-8 w-full text-xs">
						{groupBy === 'none'
							? 'No grouping'
							: groupBy === 'prefix'
								? 'Group by prefix'
								: groupBy === 'type'
									? 'Group by type'
									: 'Group by GH group'}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="none" label="No grouping" />
						<Select.Item value="prefix" label="Group by prefix" />
						<Select.Item value="type" label="Group by type" />
						{#if hasGhGroups}
							<Select.Item value="ghGroup" label="Group by GH group" />
						{/if}
					</Select.Content>
				</Select.Root>

				{#if availableTypes.length > 1}
					<div class="flex flex-wrap items-center gap-1 px-1">
						{#each availableTypes as type (type)}
							{@const active = selectedTypes.has(type)}
							<button
								type="button"
								onclick={() => toggleType(type)}
								class="rounded-full transition-opacity {active ? '' : 'opacity-60 hover:opacity-100'}"
								aria-pressed={active}
							>
								<Badge variant={active ? 'default' : 'outline'} class="cursor-pointer text-[10px]">
									{type}
								</Badge>
							</button>
						{/each}
						{#if selectedTypes.size > 0}
							<button
								type="button"
								onclick={clearTypeFilter}
								class="text-muted-foreground hover:text-foreground ml-1 text-[10px] underline"
							>
								Clear
							</button>
						{/if}
					</div>
				{/if}
			</div>
		{/if}

		{#if filteredItems.length === 0}
			<StateDisplay
				type="empty"
				size="small"
				message={searchQuery || selectedTypes.size > 0
					? 'No items match your filters.'
					: emptyMessage}
			/>
		{:else}
			{#if groupBy === 'none'}
				{@const noneCluster = clusters[0]}
				{#if noneCluster}
					{@const noneItems = clusterItemsFor(noneCluster.key, noneCluster.items)}
					<div
						use:dndzone={{
							items: noneItems,
							type: DND_TYPE_PARAM,
							dropFromOthersDisabled: true,
							autoAriaDisabled: true,
							flipDurationMs: 200,
							dropTargetStyle: {}
						}}
						onconsider={(e) => handleClusterConsider(noneCluster.key, e)}
						onfinalize={(e) => handleClusterFinalize(noneCluster.key, e)}
						class="flex flex-col gap-0"
					>
						{#each noneItems as item (item.id)}
							<DraggableItem {item} {tabs} {onAddToGroup} {onAddToNewGroup} />
						{/each}
					</div>
				{/if}
			{:else}
				<div class="flex flex-col gap-2">
					{#each clusters as cluster (cluster.key)}
						{#if cluster.items.length > 0}
							{@const items = clusterItemsFor(cluster.key, cluster.items)}
							<Collapsible.Root
								open={isClusterOpen(cluster.key)}
								onOpenChange={(o) => setClusterOpen(cluster.key, o)}
							>
								<Collapsible.Trigger
									class="hover:bg-accent/40 flex w-full items-center justify-between gap-2 rounded px-1 py-1.5 text-left transition-colors"
								>
									<span class="text-muted-foreground text-xs font-medium">
										{cluster.label} ({cluster.items.length})
									</span>
									<ChevronDown
										size={12}
										class="text-muted-foreground transition-transform duration-200 {isClusterOpen(
											cluster.key
										)
											? 'rotate-180'
											: ''}"
									/>
								</Collapsible.Trigger>
								<Collapsible.Content>
									<div
										use:dndzone={{
											items,
											type: DND_TYPE_PARAM,
											dropFromOthersDisabled: true,
											autoAriaDisabled: true,
											flipDurationMs: 200,
											dropTargetStyle: {}
										}}
										onconsider={(e) => handleClusterConsider(cluster.key, e)}
										onfinalize={(e) => handleClusterFinalize(cluster.key, e)}
										class="flex flex-col gap-0"
									>
										{#each items as item (item.id)}
											<DraggableItem {item} {tabs} {onAddToGroup} {onAddToNewGroup} />
										{/each}
									</div>
								</Collapsible.Content>
							</Collapsible.Root>
						{/if}
					{/each}
				</div>
			{/if}
		{/if}
	</Collapsible.Content>
</Collapsible.Root>
