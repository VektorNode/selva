<script lang="ts">
	import type { Snippet } from 'svelte';

	import type { GroupConfig } from '$lib/types/generated';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import DropZone from './DropZone.svelte';
	import { Trash2 } from '@lucide/svelte';

	interface EditableGroupProps {
		group: GroupConfig;
		onDrop?: (event: CustomEvent) => void;
		onReorder?: (event: CustomEvent) => void;
		onRemove: () => void;
		children: Snippet;
	}

	let { group = $bindable(), onDrop, onReorder, onRemove, children }: EditableGroupProps = $props();

	let isDragOver = $state(false);

	function toggleCollapsed() {
		group.collapsed = !group.collapsed;
	}

	function handleHeaderDragOver(e: DragEvent) {
		// Auto-expand when dragging over a collapsed group
		if (group.collapsed) {
			e.preventDefault();
			isDragOver = true;
		}
	}

	function handleHeaderDragEnter(_e: DragEvent) {
		if (group.collapsed) {
			isDragOver = true;
			// Auto-expand after a short delay
			setTimeout(() => {
				if (isDragOver && group.collapsed) {
					group.collapsed = false;
				}
			}, 300);
		}
	}

	function handleHeaderDragLeave() {
		isDragOver = false;
	}

	function handleReorderEvent(e: Event) {
		if (onReorder && e instanceof CustomEvent) {
			onReorder(e);
		}
	}

	function handleDropEvent(e: Event | CustomEvent) {
		if (onDrop && e instanceof CustomEvent) {
			onDrop(e);
		}
	}

	function setupGridRef(node: HTMLDivElement) {
		if (onReorder) {
			node.addEventListener('reorder', handleReorderEvent);
		}

		if (onDrop) {
			node.addEventListener('parameterdrop', handleDropEvent);
		}

		return {
			destroy() {
				if (onReorder) {
					node.removeEventListener('reorder', handleReorderEvent);
				}
				if (onDrop) {
					node.removeEventListener('parameterdrop', handleDropEvent);
				}
			}
		};
	}
</script>

<Card.Root
	class="gap-0 overflow-hidden border-2 bg-muted py-0 {isDragOver ? 'border-primary' : ''}"
>
	<Card.Header
		class="flex flex-row items-center justify-between gap-2 space-y-0 border-b border-border bg-card px-3 py-2"
		ondragover={handleHeaderDragOver}
		ondragenter={handleHeaderDragEnter}
		ondragleave={handleHeaderDragLeave}
		role="button"
		tabindex={0}
	>
		<div class="flex flex-1 items-center gap-1.5">
			<div class="flex flex-1 flex-col">
				<div class="">
					<button
						type="button"
						class="items-end text-xs text-muted-foreground transition-transform duration-200 hover:text-foreground {group.collapsed
							? ''
							: 'rotate-180'}"
						onclick={toggleCollapsed}
						aria-label={group.collapsed ? 'Expand group' : 'Collapse group'}
					>
						▼
					</button>
					<input
						type="text"
						bind:value={group.label}
						class="flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium text-foreground hover:border-border focus:border-primary focus:outline-none"
						placeholder="Group name"
					/>
				</div>

				<input
					type="text"
					bind:value={group.description}
					class="flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs text-muted-foreground hover:border-border focus:border-primary focus:outline-none"
					placeholder="Description"
				/>
			</div>
		</div>
		<div class="flex items-center gap-2">
			{#if !group.collapsed}
				<label class="flex items-center gap-1 text-xs text-muted-foreground">
					Col:
					<input
						type="number"
						bind:value={group.columns}
						min="1"
						max="4"
						class="w-10 rounded border border-border bg-background px-1 py-0.5 text-xs text-foreground"
					/>
				</label>
			{:else}
				<span class="text-[10px] text-muted-foreground">
					{group.items.length}
				</span>
			{/if}
			<Button variant="ghost" size="icon-lg" onclick={onRemove}>
				<Trash2 size={16} />
			</Button>
		</div>
	</Card.Header>

	{#if !group.collapsed}
		<Card.Content class="animate-[fadeIn_0.2s] p-4">
			<DropZone
				isEmpty={group.items.length === 0}
				label="Drag parameters here"
				ondrop={handleDropEvent}
			>
				<div
					use:setupGridRef
					class="grid gap-3"
					style="grid-template-columns: repeat({group.columns}, 1fr);"
				>
					{@render children()}
				</div>
			</DropZone>
		</Card.Content>
	{/if}
</Card.Root>
