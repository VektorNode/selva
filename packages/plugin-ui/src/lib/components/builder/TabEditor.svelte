<script lang="ts">
	import { Card, Button, StateDisplay } from '@selvajs/ui';
	import { EditableTabNav, EditableGroup } from '$lib/components/builder';
	import TabSettingsBar from './TabSettingsBar.svelte';
	import { Plus } from '@lucide/svelte';
	import type { TabConfig, GroupConfig, DiscoveredInput, LayoutItem } from '@selvajs/schemas';
	import { dragHandleZone, SHADOW_ITEM_MARKER_PROPERTY_NAME, TRIGGERS } from 'svelte-dnd-action';
	import type { DndEvent } from 'svelte-dnd-action';
	import { flip } from 'svelte/animate';
	import type { SvelteSet } from 'svelte/reactivity';
	import {
		DND_FLIP_MS,
		DND_TYPE_GROUP,
		draggedItemMove,
		liftDraggedGroup
	} from '$lib/dnd/dndzone-helpers';
	import { captureDragFootprint, dragFootprint } from '$lib/dnd/drag-footprint.svelte';

	interface Props {
		tabs: TabConfig[];
		activeTabId: string | null;
		onTabChange: (tabId: string) => void;
		onAddTab: () => void;
		onRemoveTab: (tabId: string) => void;
		onReorderTabs: (fromIndex: number, toIndex: number) => void;
		onAddGroup: (tabId: string) => void;
		onRemoveGroup: (tabId: string, groupId: string) => void;
		onReorderGroups: (tabId: string, fromIndex: number, toIndex: number) => void;
		onMoveGroupToTab: (sourceTabId: string, groupId: string, targetTabId: string) => void;
		onParameterDrop: (tabId: string, groupId: string, event: CustomEvent) => void;
		onReorder: (items: LayoutItem[], tabId: string, groupId: string) => void;
		onRemoveItem: (tabId: string, groupId: string, itemId: string) => void;
		onAddLineBreak: (tabId: string, groupId: string) => void;
		/** Runs `apply` as an undoable draft edit; see `editDraft`. */
		onEdit: (apply: () => void, coalesceKey?: string) => void;
		availableInputs: DiscoveredInput[];
		getParameterInfo: (paramId: string) => DiscoveredInput | undefined;
		outputValues?: Record<string, unknown>;
		/** Ids of the open item cards. */
		expandedItems: SvelteSet<string>;
	}

	let {
		tabs = $bindable(),
		activeTabId,
		onTabChange,
		onAddTab,
		onRemoveTab,
		onReorderTabs,
		onAddGroup,
		onRemoveGroup,
		onReorderGroups,
		onMoveGroupToTab,
		onParameterDrop,
		onReorder,
		onRemoveItem,
		onAddLineBreak,
		onEdit,
		availableInputs,
		getParameterInfo,
		outputValues = {},
		expandedItems
	}: Props = $props();

	const activeTab = $derived(tabs.find((t) => t.id === activeTabId));

	type ZoneGroup = GroupConfig & { isDndShadowItem?: true };

	let localGroups = $state<ZoneGroup[]>([]);
	let isGroupDragging = $state(false);
	let draggedGroupId = $state<string | null>(null);

	// Tab the user is hovering during a group drag, read on finalize to route the drop
	// as a cross-tab move instead of a same-tab reorder. Null (hovered off all tabs) means no move.
	let pendingTargetTabId = $state<string | null>(null);

	$effect(() => {
		if (!isGroupDragging && activeTab) {
			localGroups = [...(activeTab.groups as ZoneGroup[])];
		}
	});

	function handleGroupConsider(e: CustomEvent<DndEvent<ZoneGroup>>) {
		const trigger = e.detail.info?.trigger;
		const id = e.detail.info?.id;

		if (trigger === TRIGGERS.DRAG_STARTED && id) {
			draggedGroupId = id;
			captureDragFootprint(e, localGroups);
		}

		isGroupDragging = true;
		localGroups = e.detail.items;
	}

	function handleGroupFinalize(e: CustomEvent<DndEvent<ZoneGroup>>) {
		const wasDragging = isGroupDragging;
		isGroupDragging = false;
		const targetTabIdSnapshot = pendingTargetTabId;
		const draggedIdSnapshot = draggedGroupId;
		pendingTargetTabId = null;
		draggedGroupId = null;

		if (!activeTab) return;

		// Released while hovering another tab: append to destination and switch to it.
		// If they hovered off all tabs first, targetTabIdSnapshot is null and this falls
		// through to the same-tab reorder below.
		if (
			wasDragging &&
			draggedIdSnapshot &&
			targetTabIdSnapshot &&
			targetTabIdSnapshot !== activeTab.id
		) {
			onMoveGroupToTab(activeTab.id, draggedIdSnapshot, targetTabIdSnapshot);
			localGroups = [...(activeTab.groups as ZoneGroup[])];
			onTabChange(targetTabIdSnapshot);
			return;
		}

		// Drag left this zone entirely — svelte-dnd-action already moved it elsewhere.
		if (e.detail.info?.trigger === TRIGGERS.DROPPED_INTO_ANOTHER) {
			localGroups = [...(activeTab.groups as ZoneGroup[])];
			return;
		}

		const committed = e.detail.items.filter((g) => !g.isDndShadowItem) as GroupConfig[];
		const move = draggedItemMove(
			activeTab.groups.map((g) => g.id),
			committed.map((g) => g.id),
			e.detail.info.id
		);

		localGroups = committed as ZoneGroup[];

		if (move) onReorderGroups(activeTab.id, move.from, move.to);
	}
</script>

<Card.Root variant="flush" class="shrink-0">
	{#if !tabs || tabs.length === 0}
		<div class="flex flex-col items-center gap-4 p-6">
			<StateDisplay
				type="empty"
				size="large"
				title="No tabs yet"
				message="Tabs split the app into pages. Add one to start placing groups."
			/>
			<Button onclick={onAddTab}>
				<Plus />
				Add tab
			</Button>
		</div>
	{:else}
		<EditableTabNav
			{tabs}
			{activeTabId}
			{onTabChange}
			{onAddTab}
			{onReorderTabs}
			groupDragActive={isGroupDragging}
			onPendingTargetChange={(id) => (pendingTargetTabId = id)}
		/>

		{#if activeTab}
			<TabSettingsBar
				tab={activeTab}
				{onEdit}
				onRemove={() => onRemoveTab(activeTab.id)}
				onAddGroup={() => onAddGroup(activeTab.id)}
			/>

			<div class="animate-in fade-in p-4 duration-200 sm:p-6">
				<div
					use:dragHandleZone={{
						items: localGroups,
						type: DND_TYPE_GROUP,
						flipDurationMs: DND_FLIP_MS,
						dropAnimationDisabled: true,
						dropTargetStyle: {},
						transformDraggedElement: liftDraggedGroup
					}}
					onconsider={handleGroupConsider}
					onfinalize={handleGroupFinalize}
					class="flex min-h-20 flex-col gap-6"
				>
					{#each localGroups as group, groupIndex (group.id)}
						<div animate:flip={{ duration: DND_FLIP_MS }}>
							{#if group[SHADOW_ITEM_MARKER_PROPERTY_NAME]}
								<div
									style:--ghost-h="{dragFootprint.height || 80}px"
									class="border-primary/40 bg-primary/5 visible h-(--ghost-h) rounded-xl border-2 border-dashed"
								></div>
							{:else}
								<EditableGroup
									bind:group={localGroups[groupIndex] as GroupConfig}
									{onEdit}
									onFinalize={(items) => onReorder(items, activeTab.id, group.id)}
									onParameterDrop={(e) => onParameterDrop(activeTab.id, group.id, e)}
									onRemove={() => onRemoveGroup(activeTab.id, group.id)}
									onAddLineBreak={() => onAddLineBreak(activeTab.id, group.id)}
									onRemoveItem={(itemId) => onRemoveItem(activeTab.id, group.id, itemId)}
									{availableInputs}
									{getParameterInfo}
									{outputValues}
									{expandedItems}
								/>
							{/if}
						</div>
					{/each}
				</div>

				{#if activeTab.groups.length === 0 && !isGroupDragging}
					<StateDisplay
						type="empty"
						size="medium"
						message="No groups yet. Add a group, then drag parameters into it."
					/>
				{/if}
			</div>
		{/if}
	{/if}
</Card.Root>
