<script lang="ts">
	import type {
		DiscoveredInput,
		DiscoveredOutput,
		GrasshopperParamType,
		TabConfig
	} from '@selvajs/schemas';
	import { StateDisplay, Input, Badge, Select, Collapsible } from '@selvajs/ui';
	import DraggableItem from './DraggableItem.svelte';
	import { Search, X, ChevronDown, Clock } from '@lucide/svelte';
	import { getSessionIdFromUrl } from '$lib/utils/session';
	import { recentParamsStore } from '$lib/stores/recentParams.svelte';
	import { clusterItems, type GroupBy, type GroupedItem } from '$lib/utils/paramGrouping';
	import { SvelteSet } from 'svelte/reactivity';

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
		recentParamsStore.init(sessionId);
	});

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
			if (parsed.groupBy === 'none' || parsed.groupBy === 'prefix' || parsed.groupBy === 'type') {
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

	const recentIds = $derived(recentParamsStore.get(sessionId));

	const recentItems = $derived.by(() => {
		if (recentIds.length === 0) return [];
		const byId = new Map(filteredItems.map((i) => [i.id, i]));
		const out: GroupedItem[] = [];
		for (const id of recentIds) {
			const found = byId.get(id);
			if (found) out.push(found);
		}
		return out;
	});

	const clusters = $derived.by(() => {
		const recentSet = new Set(recentItems.map((i) => i.id));
		const remaining = filteredItems.filter((i) => !recentSet.has(i.id));
		return clusterItems(remaining, groupBy);
	});

	const headerCount = $derived(baseItems.length);

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
						if (value === 'none' || value === 'prefix' || value === 'type') groupBy = value;
					}}
				>
					<Select.Trigger class="h-8 w-full text-xs">
						{groupBy === 'none'
							? 'No grouping'
							: groupBy === 'prefix'
								? 'Group by prefix'
								: 'Group by type'}
					</Select.Trigger>
					<Select.Content>
						<Select.Item value="none" label="No grouping" />
						<Select.Item value="prefix" label="Group by prefix" />
						<Select.Item value="type" label="Group by type" />
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
			{#if recentItems.length > 0}
				<div class="mb-3">
					<div class="text-muted-foreground mb-1 flex items-center gap-1.5 px-1 text-[11px] font-medium uppercase tracking-wide">
						<Clock size={11} />
						Recently used
					</div>
					<div class="flex flex-col gap-0">
						{#each recentItems as item (item.id)}
							<DraggableItem {item} {tabs} {onAddToGroup} {onAddToNewGroup} />
						{/each}
					</div>
				</div>
			{/if}

			{#if groupBy === 'none'}
				<div class="flex flex-col gap-0">
					{#each clusters[0]?.items ?? [] as item (item.id)}
						<DraggableItem {item} {tabs} {onAddToGroup} {onAddToNewGroup} />
					{/each}
				</div>
			{:else}
				<div class="flex flex-col gap-2">
					{#each clusters as cluster (cluster.key)}
						{#if cluster.items.length > 0}
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
									<div class="flex flex-col gap-0">
										{#each cluster.items as item (item.id)}
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
