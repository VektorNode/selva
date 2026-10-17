<script lang="ts">
	import type { DiscoveredInput, DiscoveredOutput, TabConfig } from '@selvajs/schemas';
	import { Collapsible } from '@selvajs/ui';
	import DraggableItem from './DraggableItem.svelte';
	import { ChevronDown } from '@lucide/svelte';
	import { clusterItems, type GroupBy, type GroupedItem } from '$lib/utils/paramGrouping';
	import { dndzone, type DndEvent } from 'svelte-dnd-action';
	import { flip } from 'svelte/animate';
	import { DND_FLIP_MS, DND_TYPE_PARAM, liftDraggedElement } from '$lib/dnd/dndzone-helpers';
	import { captureDragFootprint } from '$lib/dnd/drag-footprint.svelte';
	import { usePersisted } from '$lib/composables/usePersisted.svelte';

	interface AvailableItemListProps {
		items: GroupedItem[];
		/** Stable key the open/closed folds are remembered under. */
		id: string;
		title: string;
		placedIds: ReadonlySet<string>;
		query: string;
		/** Empty means every type. */
		types: readonly string[];
		groupBy: GroupBy;
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
		id,
		title,
		placedIds,
		query,
		types,
		groupBy,
		tabs = [],
		onAddToGroup,
		onAddToNewGroup
	}: AvailableItemListProps = $props();

	// Both storage keys are read once; `id` is fixed for the component's lifetime.
	// svelte-ignore state_referenced_locally
	const sectionOpen = usePersisted(`builder.params.open:${id}`, true);
	// Keyed by `${groupBy}:${clusterKey}` so each grouping mode remembers its own folds.
	// svelte-ignore state_referenced_locally
	const clusterOpen = usePersisted<Record<string, boolean>>(`builder.params.clusters:${id}`, {});

	const unplaced = $derived(items.filter((i) => !placedIds.has(i.id)));

	const filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		return unplaced.filter((item) => {
			if (types.length > 0 && !types.includes(item.type)) return false;
			if (!q) return true;
			const description = item.description?.toLowerCase() ?? '';
			return item.nickname?.toLowerCase().includes(q) || description.includes(q);
		});
	});

	const clusters = $derived(clusterItems(filtered, groupBy));

	// Per-cluster local mirror so dndzone can mutate visually without touching the upstream
	// catalog. Source zones are read-only: once a drop completes, `placedIds` changes and
	// `clusters` re-derives, overriding any in-flight mutation.
	let localClusterItems = $state<Record<string, GroupedItem[]>>({});
	let isDragging = $state(false);

	$effect(() => {
		if (isDragging) return;
		const next: Record<string, GroupedItem[]> = {};
		for (const c of clusters) next[c.key] = [...c.items];
		localClusterItems = next;
	});

	function handleConsider(key: string, e: CustomEvent<DndEvent<GroupedItem>>) {
		captureDragFootprint(e, localClusterItems[key] ?? []);
		isDragging = true;
		localClusterItems = { ...localClusterItems, [key]: e.detail.items };
	}

	function handleFinalize(key: string, e: CustomEvent<DndEvent<GroupedItem>>) {
		isDragging = false;
		// Discard dndzone's mutated items: the destination's commit has already updated placedIds.
		const current = clusters.find((c) => c.key === key);
		localClusterItems = {
			...localClusterItems,
			[key]: current ? [...current.items] : e.detail.items
		};
	}

	function isClusterOpen(key: string): boolean {
		return clusterOpen.value[`${groupBy}:${key}`] ?? true;
	}

	function setClusterOpen(key: string, open: boolean) {
		clusterOpen.value = { ...clusterOpen.value, [`${groupBy}:${key}`]: open };
	}
</script>

{#snippet zone(key: string, fallback: GroupedItem[])}
	{@const zoneItems = localClusterItems[key] ?? fallback}
	<div
		use:dndzone={{
			items: zoneItems,
			type: DND_TYPE_PARAM,
			dropFromOthersDisabled: true,
			autoAriaDisabled: true,
			flipDurationMs: DND_FLIP_MS,
			dropTargetStyle: {},
			centreDraggedOnCursor: true,
			transformDraggedElement: liftDraggedElement
		}}
		onconsider={(e) => handleConsider(key, e)}
		onfinalize={(e) => handleFinalize(key, e)}
		class="flex flex-col gap-1"
	>
		{#each zoneItems as item (item.id)}
			<div animate:flip={{ duration: DND_FLIP_MS }}>
				<DraggableItem {item} {tabs} {onAddToGroup} {onAddToNewGroup} />
			</div>
		{/each}
	</div>
{/snippet}

<Collapsible.Root bind:open={sectionOpen.value}>
	<Collapsible.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				class="group/list bg-card sticky top-0 z-10 flex w-full items-center gap-2 py-2 text-left"
			>
				<span class="text-muted-foreground text-xs font-semibold tracking-wide uppercase"
					>{title}</span
				>
				<span class="bg-muted text-muted-foreground rounded-full px-1.5 text-xs tabular-nums">
					{unplaced.length}
				</span>
				<ChevronDown
					size={14}
					class="text-muted-foreground group-hover/list:text-foreground ml-auto transition-transform duration-200 {sectionOpen.value
						? 'rotate-180'
						: ''}"
				/>
			</button>
		{/snippet}
	</Collapsible.Trigger>

	<Collapsible.Content>
		<div class="pb-3">
			{#if unplaced.length === 0}
				<p class="text-muted-foreground py-2 text-xs">
					{items.length === 0 ? 'None found in the definition.' : 'All placed on the canvas.'}
				</p>
			{:else if filtered.length === 0}
				<p class="text-muted-foreground py-2 text-xs">No matches.</p>
			{:else if groupBy === 'none'}
				{@render zone(clusters[0].key, clusters[0].items)}
			{:else}
				<div class="flex flex-col gap-1">
					{#each clusters as cluster (cluster.key)}
						{#if cluster.items.length > 0}
							<Collapsible.Root
								open={isClusterOpen(cluster.key)}
								onOpenChange={(o) => setClusterOpen(cluster.key, o)}
							>
								<Collapsible.Trigger>
									{#snippet child({ props })}
										<button
											{...props}
											class="group/cluster text-muted-foreground hover:text-foreground flex w-full items-center gap-1.5 py-1.5 text-left text-xs"
										>
											<ChevronDown
												size={12}
												class="transition-transform duration-200 {isClusterOpen(cluster.key)
													? ''
													: '-rotate-90'}"
											/>
											<span class="truncate font-medium">{cluster.label}</span>
											<span class="tabular-nums opacity-60">{cluster.items.length}</span>
										</button>
									{/snippet}
								</Collapsible.Trigger>
								<Collapsible.Content>
									<div class="pb-2 pl-4">
										{@render zone(cluster.key, cluster.items)}
									</div>
								</Collapsible.Content>
							</Collapsible.Root>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
	</Collapsible.Content>
</Collapsible.Root>
