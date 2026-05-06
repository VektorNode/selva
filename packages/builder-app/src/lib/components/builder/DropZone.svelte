<script lang="ts">
	import type { Snippet } from 'svelte';
	import { dragStore } from '$lib/stores/dragStore.svelte';
	import { MousePointerClick } from '@lucide/svelte';

	interface Props {
		acceptTypes?: string[];
		label?: string;
		isEmpty?: boolean;
		isActive?: boolean;
		ondrop?: (e: CustomEvent) => void;
		children: Snippet;
	}

	let {
		acceptTypes = ['input', 'output', 'group-item'],
		label = 'Drop here',
		isEmpty = false,
		isActive = false,
		ondrop,
		children
	}: Props = $props();

	let isOver = $state(false);
	const showHighlight = $derived(isOver || isActive);

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		const dragData = dragStore.current;

		if (dragData && acceptTypes.includes(dragData.dropType)) {
			isOver = true;
			if (e.dataTransfer) {
				// Use "move" for group-item (reordering), "copy" for new parameters
				e.dataTransfer.dropEffect = dragData.dropType === 'group-item' ? 'move' : 'copy';
			}
		} else {
			// Still allow drop even if dragStore is empty
			isOver = true;
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = 'move';
			}
		}
	}

	function handleDragLeave(e: DragEvent) {
		// Only handle if leaving the actual drop zone, not child elements
		const relatedTarget = e.relatedTarget as Node | null;
		const currentTarget = e.currentTarget as Node;
		if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
			isOver = false;
		}
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		e.stopPropagation();
		isOver = false;

		const dragData = dragStore.current;
		if (dragData && acceptTypes.includes(dragData.dropType)) {
			// Include all relevant data for the drop handler
			const detail = {
				dropType: dragData.dropType,
				data: dragData.data,
				// For group-item drops, include source location
				...(dragData.dropType === 'group-item' && {
					sourceItem: dragData.data.item,
					sourceTabId: dragData.data.tabId,
					sourceGroupId: dragData.data.groupId
				})
			};
			ondrop?.(new CustomEvent('parameterdrop', { detail }));
		}
	}
</script>

<div
	class={`
    relative min-h-[60px] rounded-md border-2 border-dashed p-3 transition-all
    ${showHighlight ? 'border-primary bg-primary/10' : 'border-border'}
  `}
	role="region"
	aria-label={label}
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
>
	{@render children?.()}
	{#if isEmpty}
		<div
			class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2"
		>
			<MousePointerClick size={48} class="opacity-50" />
			<span class="text-muted-foreground text-sm">{label}</span>
		</div>
	{/if}
</div>
