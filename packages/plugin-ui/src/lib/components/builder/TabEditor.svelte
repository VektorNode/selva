<script lang="ts">
	import { Card, Button, StateDisplay } from '@selvajs/ui';
	import { EditableTabNav, EditableGroup } from '$lib/components/builder';
	import type { TabConfig, GroupConfig, DiscoveredInput, LayoutItem } from '@selvajs/schemas';
	import { dragHandleZone, SHADOW_ITEM_MARKER_PROPERTY_NAME, TRIGGERS } from 'svelte-dnd-action';
	import type { DndEvent } from 'svelte-dnd-action';
	import { DND_TYPE_GROUP } from '$lib/dnd/dndzone-helpers';

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
		availableInputs: DiscoveredInput[];
		getParameterInfo: (paramId: string) => DiscoveredInput | undefined;
		outputValues?: Record<string, unknown>;
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
		availableInputs,
		getParameterInfo,
		outputValues = {}
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
		const oldIds = activeTab.groups.map((g) => g.id);
		const newIds = committed.map((g) => g.id);

		let from = -1;
		let to = -1;
		for (let i = 0; i < oldIds.length; i++) {
			if (oldIds[i] !== newIds[i]) {
				from = oldIds.indexOf(newIds[i]);
				to = i;
				break;
			}
		}

		localGroups = committed as ZoneGroup[];

		if (from !== -1 && to !== -1 && from !== to) {
			onReorderGroups(activeTab.id, from, to);
		}
	}
</script>

<Card.Root class="shadow-sm">
	<Card.Header class="flex flex-row items-center justify-between space-y-0">
		<div></div>
		<Button onclick={onAddTab}>+ Add Tab</Button>
	</Card.Header>
	<Card.Content>
		<div class="min-h-[200px]">
			{#if !tabs || tabs.length === 0}
				<StateDisplay
					type="empty"
					size="large"
					title="No tabs yet"
					message="Click 'Add Tab' to create your first tab"
				/>
			{:else}
				<EditableTabNav
					{tabs}
					{activeTabId}
					{onTabChange}
					{onRemoveTab}
					{onReorderTabs}
					groupDragActive={isGroupDragging}
					onPendingTargetChange={(id) => (pendingTargetTabId = id)}
				/>

				{#if activeTab}
					<div class="animate-[fadeIn_0.2s]">
						<div class="mb-6 flex justify-end">
							<Button variant="outline" onclick={() => onAddGroup(activeTab.id)}>
								+ Add Group
							</Button>
						</div>

						<div
							use:dragHandleZone={{
								items: localGroups,
								type: DND_TYPE_GROUP,
								flipDurationMs: 200,
								dropAnimationDisabled: true,
								dropTargetClasses: ['ring-2', 'ring-primary'],
								dropTargetStyle: {}
							}}
							onconsider={handleGroupConsider}
							onfinalize={handleGroupFinalize}
							class="flex min-h-20 flex-col gap-6"
						>
							{#each localGroups as group, groupIndex (group.id)}
								{#if (group as ZoneGroup)[SHADOW_ITEM_MARKER_PROPERTY_NAME]}
									<div
										class="border-primary/30 bg-primary/5 min-h-20 rounded border-2 border-dashed"
									></div>
								{:else}
									<EditableGroup
										bind:group={localGroups[groupIndex] as GroupConfig}
										onFinalize={(items) => onReorder(items, activeTab.id, group.id)}
										onParameterDrop={(e) => onParameterDrop(activeTab.id, group.id, e)}
										onRemove={() => onRemoveGroup(activeTab.id, group.id)}
										onAddLineBreak={() => onAddLineBreak(activeTab.id, group.id)}
										onRemoveItem={(itemId) => onRemoveItem(activeTab.id, group.id, itemId)}
										{availableInputs}
										{getParameterInfo}
										{outputValues}
									/>
								{/if}
							{/each}
						</div>

						{#if activeTab.groups.length === 0 && !isGroupDragging}
							<StateDisplay
								type="empty"
								size="medium"
								message="No groups yet. Click 'Add Group' to organize your parameters."
							/>
						{/if}
					</div>
				{/if}
			{/if}
		</div>
	</Card.Content>
</Card.Root>
