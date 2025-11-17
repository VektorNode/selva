<script lang="ts">
	import Button from './Button.svelte';
	import Badge from './Badge.svelte';
	import { dragStore } from '$lib/stores/dragStore.svelte';
	import type { GroupItem, AvailableParameter } from '$lib/types/schema';

	interface BuilderGroupItemProps {
		item: GroupItem;
		paramInfo?: AvailableParameter;
		tabId: string;
		groupId: string;
		onRemove: () => void;
	}

	let { item, paramInfo, tabId, groupId, onRemove }: BuilderGroupItemProps = $props();

	let isDragging = $state(false);
	let isDragOver = $state(false);
	let dropPosition: 'before' | 'after' | null = $state(null);

	function handleDragStart(e: DragEvent) {
		const target = e.target as HTMLElement;

		// Prevent drag from input fields or buttons
		if (target.tagName === 'INPUT' || target.tagName === 'BUTTON' || target.closest('button')) {
			e.preventDefault();
			return;
		}

		isDragging = true;
		dragStore.set({
			type: 'group-item',
			data: { item, tabId, groupId },
			sourceType: 'reorder'
		});

		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', item.id);
		}
	}

	function handleDragEnd() {
		isDragging = false;
		dragStore.clear();
	}

	function handleDragOver(e: DragEvent) {
		const dragData = dragStore.current;

		// Allow drop if dragging a group item (reorder) or a new parameter
		if (dragData?.type === 'group-item' || dragData?.type === 'parameter') {
			e.preventDefault(); // This must be called to allow drop
			e.stopPropagation(); // Prevent DropZone from interfering
			isDragOver = true;

			// Determine if we're in the top or bottom half of the element
			const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
			const midpoint = rect.top + rect.height / 2;
			dropPosition = e.clientY < midpoint ? 'before' : 'after';

			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = dragData.type === 'group-item' ? 'move' : 'copy';
			}
		}
	}

	function handleDragLeave() {
		isDragOver = false;
		dropPosition = null;
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation(); // Prevent DropZone from handling this drop
		isDragOver = false;

		const dragData = dragStore.current;
		if (!dragData) return;

		if (dragData.type === 'group-item') {
			// Reordering existing item
			const detail = {
				sourceItem: dragData.data.item,
				sourceTabId: dragData.data.tabId,
				sourceGroupId: dragData.data.groupId,
				targetItem: item,
				targetTabId: tabId,
				targetGroupId: groupId,
				dropPosition: dropPosition || 'after'
			};

			const event = new CustomEvent('reorder', {
				detail,
				bubbles: true,
				composed: true
			});

			(e.currentTarget as HTMLElement).dispatchEvent(event);
		} else if (dragData.type === 'parameter') {
			// Adding new parameter with position
			const detail = {
				type: 'parameter',
				data: dragData.data,
				sourceType: dragData.sourceType,
				targetItem: item,
				targetTabId: tabId,
				targetGroupId: groupId,
				dropPosition: dropPosition || 'after'
			};

			const event = new CustomEvent('parameterdrop', {
				detail,
				bubbles: true,
				composed: true
			});

			(e.currentTarget as HTMLElement).dispatchEvent(event);
		}

		dropPosition = null;
	}
</script>

<div class="relative">
	{#if isDragOver && dropPosition === 'before'}
		<div class="absolute -top-1 left-0 right-0 h-0.5 bg-blue-600 rounded-full z-10"></div>
	{/if}
	{#if isDragOver && dropPosition === 'after'}
		<div class="absolute -bottom-1 left-0 right-0 h-0.5 bg-blue-600 rounded-full z-10"></div>
	{/if}

	<div
		class={`
			bg-white border border-gray-300 rounded-md p-3 transition-all
			cursor-grab hover:border-blue-600 hover:shadow-md
			${isDragging ? 'opacity-50 cursor-grabbing' : ''}
			${isDragOver ? 'border-blue-600' : ''}
		`}
		draggable="true"
		role="button"
		tabindex="0"
		ondragstart={handleDragStart}
		ondragend={handleDragEnd}
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
	>
	<div class="flex items-center gap-2 mb-2">
		<span class="text-base">
			{item.type === 'input' ? '📥' : '📤'}
		</span>
		<input
			type="text"
			bind:value={item.displayName}
			class="flex-1 font-medium border border-transparent px-2 py-1 rounded-sm text-sm hover:border-gray-300 focus:border-blue-600 focus:outline-none"
			placeholder={paramInfo?.name || ''}
		/>
	</div>
	{#if paramInfo}
		<div class="flex gap-2 mb-2 text-xs">
			<Badge variant="info" size="small">
				{paramInfo.paramType}
			</Badge>
			<span class="text-gray-500 font-mono">
				{paramInfo.nickname}
			</span>
		</div>
	{/if}
	<div class="flex gap-2 justify-between items-center">
		<span class="text-gray-400 text-xs cursor-grab select-none hover:text-gray-600">
			⋮⋮ Drag to reorder
		</span>
		<Button
			variant="ghost"
			size="mini"
			class="hover:bg-red-600 hover:text-white"
			onclick={onRemove}
		>
			×
		</Button>
	</div>
	</div>
</div>
