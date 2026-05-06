<script lang="ts">
	import type {
		LayoutItem,
		GroupConfig,
		DiscoveredInput,
		InputLayoutItem,
		OutputLayoutItem,
		LineBreakLayoutItem
	} from '@selvajs/schemas';
	import { Button, Card } from '@selvajs/ui';
	import DropZone from './DropZone.svelte';
	import BuilderGroupItem from './BuilderGroupItem.svelte';
	import LineBreakItem from './LineBreakItem.svelte';
	import { ChevronDown, GripVertical, Trash2 } from '@lucide/svelte';
	import VisibilityRulesEditor from './VisibilityRulesEditor.svelte';
	import { dndzone } from 'svelte-dnd-action';
	import type { DndEvent } from 'svelte-dnd-action';
	import { dragStore } from '$lib/stores/dragStore.svelte';
	import { SvelteMap } from 'svelte/reactivity';

	type DndLayoutItem = LayoutItem & { isDndShadowItem?: true };

	interface EditableGroupProps {
		group: GroupConfig;
		onFinalize: (items: LayoutItem[]) => void;
		onParameterDrop?: (event: CustomEvent) => void;
		onRemove: () => void;
		onAddLineBreak: () => void;
		onRemoveItem: (itemId: string) => void;
		onDragStart?: (event: DragEvent) => void;
		onDragEnd?: (event: DragEvent) => void;
		isDragging?: boolean;
		availableInputs: DiscoveredInput[];
		getParameterInfo: (paramId: string) => DiscoveredInput | undefined;
		outputValues?: Record<string, unknown>;
	}

	let {
		group = $bindable(),
		onFinalize,
		onParameterDrop,
		onRemove,
		onAddLineBreak,
		onRemoveItem,
		onDragStart,
		onDragEnd,
		isDragging = false,
		availableInputs,
		getParameterInfo,
		outputValues = {}
	}: EditableGroupProps = $props();

	let isDragOver = $state(false);
	let showVisibilityRules = $state(false);
	let hasVisibilityRules = $derived((group.visibilityCondition?.rules?.length ?? 0) > 0);
	const expandedItems = new SvelteMap<string, boolean>();
	function isExpanded(id: string) {
		return expandedItems.get(id) ?? false;
	}
	function setExpanded(id: string, value: boolean) {
		expandedItems.set(id, value);
	}

	// Local items for dnd preview — synced from group.items when not dragging
	let localItems = $state<DndLayoutItem[]>([]);
	let isItemDragging = $state(false);
	let draggedSpan = $state(1);

	$effect(() => {
		if (!isItemDragging) {
			localItems = [...(group.items as DndLayoutItem[])];
		}
	});

	// Disable dndzone when dragging from the sidebar (native HTML5 drag)
	const isSidebarDragging = $derived(
		dragStore.current?.dropType === 'input' || dragStore.current?.dropType === 'output'
	);

	// True while a dnd-action drag is hovering this zone (shadow placeholder is present)
	const isDndTarget = $derived(localItems.some((i) => i.isDndShadowItem));

	function handleConsider(e: CustomEvent<DndEvent<DndLayoutItem>>) {
		isItemDragging = true;
		const draggedId = e.detail.info?.id;
		if (draggedId) {
			// Look up span from current items (before shadow replaces the slot)
			const all = [...localItems, ...(group.items as DndLayoutItem[])];
			const dragged = all.find((i) => i.id === draggedId && !i.isDndShadowItem);
			if (dragged?.type === 'linebreak') {
				draggedSpan = group.columns ?? 1;
			} else {
				draggedSpan = (dragged as InputLayoutItem | OutputLayoutItem | undefined)?.span ?? 1;
			}
		}
		localItems = e.detail.items;
	}

	function handleFinalize(e: CustomEvent<DndEvent<DndLayoutItem>>) {
		isItemDragging = false;
		const committed = e.detail.items.filter((i) => !i.isDndShadowItem) as LayoutItem[];
		localItems = committed as DndLayoutItem[];
		onFinalize(committed);
	}

	function handleDropEvent(e: Event | CustomEvent) {
		if (onParameterDrop && e instanceof CustomEvent) {
			onParameterDrop(e);
		}
	}

	function toggleCollapsed() {
		group.collapsed = !group.collapsed;
	}
</script>

<Card.Root
	class="group bg-muted gap-0 overflow-hidden border-2 py-0 {isDragOver ? 'border-primary' : ''}"
>
	<Card.Header
		class="border-border bg-card flex flex-row items-center justify-between gap-2 space-y-0 border-b px-3 py-3 {isDragging
			? 'opacity-50'
			: ''}  transition-colors"
	>
		<!-- Drag Handle (group-level, native HTML5) -->
		<div
			class="text-muted-foreground hover:text-foreground hover:bg-accent flex cursor-grab rounded p-1 opacity-40 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
			role="button"
			tabindex="0"
			aria-label="Drag to reorder"
			draggable="true"
			ondragstart={onDragStart}
			ondragend={onDragEnd}
		>
			<GripVertical size={16} />
		</div>
		<div class="flex flex-1 items-center gap-1.5">
			<div class="flex flex-1 flex-col gap-0.5">
				<div class="flex items-center gap-1">
					<button
						type="button"
						class="text-muted-foreground hover:text-foreground hover:bg-accent/50 flex h-6 w-6 shrink-0 items-center justify-center rounded transition-transform duration-200 {group.collapsed
							? ''
							: 'rotate-180'}"
						onclick={toggleCollapsed}
						aria-label={group.collapsed ? 'Expand group' : 'Collapse group'}
					>
						<ChevronDown size={16} />
					</button>
					<input
						type="text"
						bind:value={group.label}
						class="text-foreground hover:border-border focus:border-primary flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-base font-semibold focus:outline-none"
						placeholder="Group name"
					/>
				</div>

				<input
					type="text"
					bind:value={group.description}
					class="text-muted-foreground hover:border-border focus:border-primary ml-7 flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs focus:outline-none"
					placeholder="Description"
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
					/>
				</label>
				<Button
					variant="ghost"
					size="sm"
					class="text-muted-foreground h-6 px-2 text-[10px]"
					onclick={onAddLineBreak}
				>
					+ Line Break
				</Button>
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

	<!-- Visibility Rules Section -->
	{#if !group.collapsed}
		<div class="border-border bg-muted border-t px-3 py-2">
			<button
				onclick={() => (showVisibilityRules = !showVisibilityRules)}
				class="text-muted-foreground hover:text-foreground mb-2 flex w-full items-center gap-1 text-[11px]"
			>
				<ChevronDown
					size={12}
					class={`transition-transform ${showVisibilityRules ? 'rotate-180' : ''}`}
				/>
				Visibility Rules {hasVisibilityRules
					? `(${group.visibilityCondition?.rules?.length ?? 0})`
					: ''}
			</button>

			{#if showVisibilityRules}
				<div class="bg-card mt-2 rounded p-2">
					<VisibilityRulesEditor
						bind:visibilityCondition={group.visibilityCondition}
						{availableInputs}
						currentParamInfo={undefined}
						{getParameterInfo}
						isGroupCondition={true}
					/>
				</div>
			{/if}
		</div>
	{/if}

	{#if !group.collapsed}
		<Card.Content class="bg-muted animate-[fadeIn_0.2s] p-4">
			<DropZone
				isEmpty={group.items.length === 0}
				isActive={isDndTarget}
				label="Drag parameters here"
				ondrop={handleDropEvent}
			>
				<div
					use:dndzone={{
						items: localItems,
						type: 'group-item',
						flipDurationMs: 200,
						dragDisabled: isSidebarDragging,
						dropTargetStyle: {}
					}}
					onconsider={handleConsider}
					onfinalize={handleFinalize}
					class="grid min-h-[3.5rem] items-start gap-3"
					style="grid-template-columns: repeat({group.columns}, 1fr);"
				>
					{#each localItems as item (item.id)}
						{#if item.isDndShadowItem}
							<!-- Placeholder: outer div gets visibility:hidden from dndzone; inner overrides with visibility:visible -->
							<div
								style="grid-column: {draggedSpan >= (group.columns ?? 1)
									? '1 / -1'
									: `span ${draggedSpan}`}"
							>
								<div
									style="visibility: visible; min-height: 3rem;"
									class="border-primary/30 bg-primary/5 pointer-events-none rounded border-2 border-dashed"
								></div>
							</div>
						{:else if item.type === 'linebreak'}
							<div style="grid-column: 1 / -1;">
								<LineBreakItem
									item={item as LineBreakLayoutItem}
									onRemove={() => onRemoveItem(item.id)}
								/>
							</div>
						{:else}
							{@const idx = localItems.indexOf(item)}
							<div
								style="grid-column: span {Math.min(
									Math.max(1, item.span ?? 1),
									group.columns ?? 1
								)}"
							>
								<BuilderGroupItem
									bind:item={localItems[idx] as InputLayoutItem | OutputLayoutItem}
									paramInfo={getParameterInfo(item.paramId)}
									columns={group.columns}
									bind:expanded={() => isExpanded(item.id), (v) => setExpanded(item.id, v)}
									{availableInputs}
									{getParameterInfo}
									currentValue={outputValues[item.paramId]}
									onRemove={() => onRemoveItem(item.id)}
								/>
							</div>
						{/if}
					{/each}
				</div>
			</DropZone>
		</Card.Content>
	{/if}
</Card.Root>
