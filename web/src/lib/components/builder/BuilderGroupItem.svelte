<script lang="ts">
	import { dragStore } from '$lib/stores/dragStore.svelte';
	import type { LayoutItem, AvailableParameter, NumberWidgetConfig } from '$lib/types/generated';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { ArrowDownToLine, ArrowUpFromLine } from '@lucide/svelte';

	interface BuilderGroupItemProps {
		item: LayoutItem;
		paramInfo?: AvailableParameter;
		tabId: string;
		groupId: string;
		onRemove: () => void;
	}

	let { item, paramInfo, tabId, groupId, onRemove }: BuilderGroupItemProps = $props();

	// Check if this is a number widget
	let isNumberInput = $derived(item.type === 'input' && item.widgetType === 'number');

	function toggleSliderMode() {
		if (item.type === 'input' && item.widgetType === 'number') {
			const config = item.config as NumberWidgetConfig;
			config.renderAsSlider = !config.renderAsSlider;
		}
	}

	let isDragging = $state(false);
	let isDragOver = $state(false);
	let dropPosition: 'before' | 'after' | null = $state(null);
	let canDrag = $state(true);

	function handleDragStart(e: DragEvent) {
		if (!canDrag) {
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
		<div class="absolute -top-1 right-0 left-0 z-10 h-0.5 rounded-full bg-blue-600"></div>
	{/if}
	{#if isDragOver && dropPosition === 'after'}
		<div class="absolute right-0 -bottom-1 left-0 z-10 h-0.5 rounded-full bg-blue-600"></div>
	{/if}

	<Card.Root
		class={`
      cursor-grab p-2 transition-all hover:border-primary hover:shadow-sm
      ${isDragging ? 'cursor-grabbing opacity-50' : ''}
      ${isDragOver ? 'border-primary' : ''}
      ${item.type === 'input' ? "bg-inputparam" : "bg-outputparam"}
      mb-2 gap-1.5
    `}
		draggable="true"
		role="button"
		ondragstart={handleDragStart}
		ondragend={handleDragEnd}
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
	>
		<div class="flex w-full flex-row justify-between gap-2">
			<span
				class="flex cursor-grab items-center text-[10px] text-muted-foreground select-none hover:text-foreground"
			>
				<span class="text-sm">
					{#if item.type === 'input'}
						<ArrowDownToLine size={14} />
					{:else}
						<ArrowUpFromLine size={14} />
					{/if}
				</span>
			</span>
			<div class="ml-1 flex flex-1 flex-col">
				<div class="mb-1 flex items-center gap-1.5">
					<input
						type="text"
						bind:value={item.displayName}
						class="flex-1 rounded-sm border border-transparent bg-transparent px-1.5 text-xs font-medium text-foreground hover:border-border focus:border-primary focus:outline-none"
						placeholder={'Display Name'}
						onmousedown={() => (canDrag = false)}
						onmouseup={() => (canDrag = true)}
						onmouseleave={() => (canDrag = true)}
					/>
					<Button
						variant="ghost"
						size="icon-sm"
						class="hover:text-destructive-foreground h-5 w-5 hover:bg-destructive"
						onclick={onRemove}
					>
						×
					</Button>
				</div>
				<div class="mb-1 flex items-center justify-between gap-1.5 text-xs">
					<input
						type="text"
						bind:value={item.description}
						class="h-6 flex-1 rounded-sm border border-transparent bg-transparent px-1 py-0 text-[10px] text-muted-foreground hover:border-border focus:border-primary focus:outline-none"
						placeholder="Description"
						onmousedown={() => (canDrag = false)}
						onmouseup={() => (canDrag = true)}
						onmouseleave={() => (canDrag = true)}
					/>
					{#if paramInfo}
						<div class="flex items-center gap-1.5">
							<Badge variant="default" class="px-1.5 py-0 text-[10px]">
								{paramInfo.paramType}
							</Badge>
							<span class="font-mono text-[10px] text-muted-foreground">
								{paramInfo.nickname}
							</span>
						</div>
					{/if}
				</div>
				{#if isNumberInput}
					{@const config = (item as any).config as NumberWidgetConfig}
					<div class="flex items-center gap-2 border-t border-border px-1.5 py-1">
						<span class="text-[10px] text-muted-foreground">Input</span>
						<Switch
							checked={config.renderAsSlider ?? true}
							onCheckedChange={toggleSliderMode}
							class="scale-75"
						/>
						<span class="text-[10px] text-muted-foreground">Slider</span>
					</div>
				{/if}
			</div>
		</div></Card.Root
	>
</div>
