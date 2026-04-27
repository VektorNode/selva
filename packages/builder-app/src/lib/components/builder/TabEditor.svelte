<script lang="ts">
	import { Card, Button, StateDisplay } from '@selvajs/ui';
	import { EditableTabNav, EditableGroup } from '$lib/components/builder';
	import type { TabConfig, DiscoveredInput, LayoutItem } from '@selvajs/schemas';
	import { dragStore } from '$lib/stores/dragStore.svelte';

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
		onParameterDrop,
		onReorder,
		onRemoveItem,
		onAddLineBreak,
		availableInputs,
		getParameterInfo,
		outputValues = {}
	}: Props = $props();

	const activeTab = $derived(tabs.find((t) => t.id === activeTabId));

	// Drag state for group reordering (native HTML5 DnD — untouched)
	let draggedGroupId: string | null = $state(null);
	let dragOverGroupId: string | null = $state(null);

	// Clear group drag state when sidebar items are being dragged
	$effect(() => {
		if (dragStore.current) {
			draggedGroupId = null;
			dragOverGroupId = null;
		}
	});

	function handleGroupDragStart(e: DragEvent, groupId: string) {
		const target = e.target as HTMLElement;
		let element: HTMLElement | null = target;
		while (element && element !== e.currentTarget) {
			if (
				element.tagName === 'INPUT' ||
				element.tagName === 'TEXTAREA' ||
				element.tagName === 'BUTTON'
			) {
				e.preventDefault();
				e.stopPropagation();
				return;
			}
			element = element.parentElement;
		}

		draggedGroupId = groupId;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('application/x-group', groupId);
		}
	}

	function handleGroupDragOver(e: DragEvent, groupId: string) {
		if (!draggedGroupId || draggedGroupId === groupId) return;
		if (dragStore.current) return;
		if (!e.dataTransfer?.types.includes('application/x-group')) return;

		e.preventDefault();
		dragOverGroupId = groupId;
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'move';
		}
	}

	function handleGroupDragLeave(e: DragEvent, groupId: string) {
		if (dragOverGroupId !== groupId) return;
		const relatedTarget = e.relatedTarget as Node | null;
		const currentTarget = e.currentTarget as Node;
		if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
			dragOverGroupId = null;
		}
	}

	function handleGroupDrop(e: DragEvent, targetGroupId: string) {
		e.preventDefault();
		e.stopPropagation();

		if (!draggedGroupId || !activeTab) return;

		const fromIndex = activeTab.groups.findIndex((g) => g.id === draggedGroupId);
		const toIndex = activeTab.groups.findIndex((g) => g.id === targetGroupId);

		if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
			onReorderGroups(activeTab.id, fromIndex, toIndex);
		}

		draggedGroupId = null;
		dragOverGroupId = null;
	}

	function handleGroupDragEnd() {
		draggedGroupId = null;
		dragOverGroupId = null;
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
				<!-- Tab Navigation -->
				<EditableTabNav {tabs} {activeTabId} {onTabChange} {onRemoveTab} {onReorderTabs} />

				<!-- Active Tab Content -->
				{#if activeTab}
					<div class="animate-[fadeIn_0.2s]">
						<div class="mb-6 flex justify-end">
							<Button variant="outline" onclick={() => onAddGroup(activeTab.id)}>
								+ Add Group
							</Button>
						</div>

						{#if activeTab.groups.length === 0}
							<StateDisplay
								type="empty"
								size="medium"
								message="No groups yet. Click 'Add Group' to organize your parameters."
							/>
						{:else}
							<div class="flex flex-col gap-6">
								{#each activeTab.groups as group, groupIndex (group.id)}
									<div
										class="transition-opacity {draggedGroupId === group.id
											? 'opacity-50'
											: ''} {dragOverGroupId === group.id ? 'border-t-primary border-t-4' : ''}"
										ondragover={(e) => handleGroupDragOver(e, group.id)}
										ondragleave={(e) => handleGroupDragLeave(e, group.id)}
										ondrop={(e) => handleGroupDrop(e, group.id)}
										role="group"
										tabindex="-1"
									>
										<EditableGroup
											bind:group={activeTab.groups[groupIndex]}
											onFinalize={(items) => onReorder(items, activeTab.id, group.id)}
											onParameterDrop={(e) => onParameterDrop(activeTab.id, group.id, e)}
											onRemove={() => onRemoveGroup(activeTab.id, group.id)}
											onAddLineBreak={() => onAddLineBreak(activeTab.id, group.id)}
											onRemoveItem={(itemId) => onRemoveItem(activeTab.id, group.id, itemId)}
											onDragStart={(e) => handleGroupDragStart(e, group.id)}
											onDragEnd={handleGroupDragEnd}
											isDragging={draggedGroupId === group.id}
											{availableInputs}
											{getParameterInfo}
											{outputValues}
										/>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			{/if}
		</div>
	</Card.Content>
</Card.Root>
