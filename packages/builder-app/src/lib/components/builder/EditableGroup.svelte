<script lang="ts">
	import type { Snippet } from 'svelte';

	import type { GroupConfig } from '@selva/shared';
	import { Button, Card } from '@selva/shared';
	import DropZone from './DropZone.svelte';
	import { ChevronDown, Trash2 } from '@lucide/svelte';

	interface EditableGroupProps {
		group: GroupConfig;
		onDrop?: (event: CustomEvent) => void;
		onReorder?: (event: CustomEvent) => void;
		onRemove: () => void;
		onDragStart?: (event: DragEvent) => void;
		onDragEnd?: (event: DragEvent) => void;
		isDragging?: boolean;
		children: Snippet;
	}

	let {
		group = $bindable(),
		onDrop,
		onReorder,
		onRemove,
		onDragStart,
		onDragEnd,
		isDragging = false,
		children
	}: EditableGroupProps = $props();

	let isDragOver = $state(false);

	function toggleCollapsed() {
		group.collapsed = !group.collapsed;
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
	class="bg-muted gap-0 overflow-hidden border-2 py-0 {isDragOver ? 'border-primary' : ''}"
>
	<Card.Header
		class="border-border bg-card flex flex-row items-center justify-between gap-2 space-y-0 border-b px-3 py-2 {isDragging
			? 'opacity-50'
			: 'cursor-grab'} hover:bg-accent/50 transition-colors"
		role="button"
		tabindex={0}
		draggable={true}
		ondragstart={onDragStart}
		ondragend={onDragEnd}
	>
		<div class="flex flex-1 items-center gap-1.5">
			<div class="flex flex-1 flex-col">
				<div class="">
					<button
						type="button"
						class="text-muted-foreground hover:text-foreground items-center text-xs transition-transform duration-200 {group.collapsed
							? ''
							: 'rotate-180'}"
						onclick={toggleCollapsed}
						aria-label={group.collapsed ? 'Expand group' : 'Collapse group'}
					>
						<ChevronDown size={14} />
					</button>
					<input
						type="text"
						bind:value={group.label}
						class="text-foreground hover:border-border focus:border-primary flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-sm font-medium focus:outline-none"
						placeholder="Group name"
						draggable="false"
						onmousedown={(e) => e.stopPropagation()}
						ondragstart={(e) => e.preventDefault()}
					/>
				</div>

				<input
					type="text"
					bind:value={group.description}
					class="text-muted-foreground hover:border-border focus:border-primary flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs focus:outline-none"
					placeholder="Description"
					draggable="false"
					onmousedown={(e) => e.stopPropagation()}
					ondragstart={(e) => e.preventDefault()}
				/>
			</div>
		</div>
		<div class="flex items-center gap-2">
			{#if !group.collapsed}
				<label class="text-muted-foreground flex items-center gap-1 text-xs">
					Col:
					<input
						type="number"
						bind:value={group.columns}
						min="1"
						max="4"
						class="border-border bg-background text-foreground w-10 rounded border px-1 py-0.5 text-xs"
						draggable="false"
						onmousedown={(e) => e.stopPropagation()}
						ondragstart={(e) => e.preventDefault()}
					/>
				</label>
			{:else}
				<span class="text-muted-foreground text-[10px]">
					{group.items.length}
				</span>
			{/if}
			<Button variant="ghost" size="icon-lg" onclick={onRemove}>
				<Trash2 size={16} />
			</Button>
		</div>
	</Card.Header>

	{#if !group.collapsed}
		<Card.Content class="bg-muted animate-[fadeIn_0.2s] p-4">
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
