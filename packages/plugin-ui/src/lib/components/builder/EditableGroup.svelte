<script lang="ts">
	import type {
		LayoutItem,
		GroupConfig,
		DiscoveredInput,
		DiscoveredOutput,
		InputLayoutItem,
		OutputLayoutItem,
		LineBreakLayoutItem
	} from '@selvajs/schemas';
	import { Button, Card } from '@selvajs/ui';
	import BuilderGroupItem from './BuilderGroupItem.svelte';
	import LineBreakItem from './LineBreakItem.svelte';
	import { ChevronDown, GripVertical, MousePointerClick, Trash2 } from '@lucide/svelte';
	import VisibilityRulesEditor from './VisibilityRulesEditor.svelte';
	import {
		dragHandle,
		dragHandleZone,
		SHADOW_ITEM_MARKER_PROPERTY_NAME,
		TRIGGERS
	} from 'svelte-dnd-action';
	import type { DndEvent } from 'svelte-dnd-action';
	import { flip } from 'svelte/animate';
	import { SvelteMap } from 'svelte/reactivity';
	import {
		DND_FLIP_MS,
		DND_TYPE_PARAM,
		isDiscoveredInput,
		isDiscoveredOutput,
		liftDraggedElement
	} from '$lib/dnd/dndzone-helpers';
	import { captureDragFootprint, dragFootprint } from '$lib/dnd/drag-footprint.svelte';

	type ZoneItem = (LayoutItem | DiscoveredInput | DiscoveredOutput) & {
		isDndShadowItem?: true;
	};

	interface EditableGroupProps {
		group: GroupConfig;
		/** Runs `apply` as an undoable draft edit; see `editDraft`. */
		onEdit: (apply: () => void, coalesceKey?: string) => void;
		onFinalize: (items: LayoutItem[]) => void;
		onParameterDrop?: (event: CustomEvent) => void;
		onRemove: () => void;
		onAddLineBreak: () => void;
		onRemoveItem: (itemId: string) => void;
		availableInputs: DiscoveredInput[];
		getParameterInfo: (paramId: string) => DiscoveredInput | undefined;
		outputValues?: Record<string, unknown>;
	}

	let {
		group = $bindable(),
		onEdit,
		onFinalize,
		onParameterDrop,
		onRemove,
		onAddLineBreak,
		onRemoveItem,
		availableInputs,
		getParameterInfo,
		outputValues = {}
	}: EditableGroupProps = $props();

	let showVisibilityRules = $state(false);
	let hasVisibilityRules = $derived((group.visibilityCondition?.rules?.length ?? 0) > 0);
	const expandedItems = new SvelteMap<string, boolean>();
	function isExpanded(id: string) {
		return expandedItems.get(id) ?? false;
	}
	function setExpanded(id: string, value: boolean) {
		expandedItems.set(id, value);
	}

	// Local items mirror — synced from group.items when not dragging.
	let localItems = $state<ZoneItem[]>([]);
	let isItemDragging = $state(false);
	let draggedSpan = $state(1);
	let ghostHeight = $state(0);
	// Only the origin zone is guaranteed a finalize; a zone the item merely passed through gets
	// its last consider on leave, so it has to stop mirroring there or it never resyncs.
	let isDragOrigin = false;

	$effect(() => {
		if (!isItemDragging) {
			localItems = [...(group.items as ZoneItem[])];
		}
	});

	// True while a placeholder is hovering the zone — used for visual highlight.
	const isDndTarget = $derived(localItems.some((i) => i.isDndShadowItem));

	function handleConsider(e: CustomEvent<DndEvent<ZoneItem>>) {
		if (e.detail.info.trigger === TRIGGERS.DRAG_STARTED) {
			isDragOrigin = true;
			captureDragFootprint(e, localItems);
		}
		// The shadow item carries the dragged item's data, wherever the drag started.
		const shadow = e.detail.items.find((i) => i.isDndShadowItem);
		isItemDragging = isDragOrigin || !!shadow;
		if (shadow) {
			if (isDiscoveredInput(shadow) || isDiscoveredOutput(shadow)) {
				// A sidebar row is shorter than the card it becomes; size the slot for the card.
				draggedSpan = 1;
				ghostHeight = placedItemHeight() || dragFootprint.height;
			} else {
				draggedSpan =
					'type' in shadow && shadow.type === 'linebreak'
						? (group.columns ?? 1)
						: ((shadow as InputLayoutItem | OutputLayoutItem).span ?? 1);
				ghostHeight = dragFootprint.height;
			}
		}
		localItems = e.detail.items;
	}

	function handleFinalize(e: CustomEvent<DndEvent<ZoneItem>>) {
		isItemDragging = false;
		isDragOrigin = false;

		const items = e.detail.items.filter((i) => !i.isDndShadowItem);

		// Detect foreign items (sidebar drops) and route through onParameterDrop.
		// The local commit-then-snapshot does not happen for foreign items —
		// onParameterDrop pushes its own history snapshot and mutates the schema,
		// which re-syncs via the $effect.
		const foreignIndices: number[] = [];
		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (isDiscoveredInput(item) || isDiscoveredOutput(item)) {
				foreignIndices.push(i);
			}
		}

		if (foreignIndices.length > 0 && onParameterDrop) {
			for (const idx of foreignIndices) {
				const foreign = items[idx];
				let targetItem: LayoutItem | undefined;
				let dropPosition: 'before' | 'after' | undefined;
				// Prefer the next neighbour (drop before it). Fall back to previous.
				for (let j = idx + 1; j < items.length; j++) {
					const candidate = items[j];
					if (!isDiscoveredInput(candidate) && !isDiscoveredOutput(candidate)) {
						targetItem = candidate as LayoutItem;
						dropPosition = 'before';
						break;
					}
				}
				if (!targetItem) {
					for (let j = idx - 1; j >= 0; j--) {
						const candidate = items[j];
						if (!isDiscoveredInput(candidate) && !isDiscoveredOutput(candidate)) {
							targetItem = candidate as LayoutItem;
							dropPosition = 'after';
							break;
						}
					}
				}

				const dropType = isDiscoveredInput(foreign) ? 'input' : 'output';
				const detail = {
					dropType,
					data: foreign,
					targetItem,
					dropPosition
				};
				onParameterDrop(new CustomEvent('parameterdrop', { detail }));
			}
			// Resync local from group.items — the $effect won't fire mid-handler
			// (isItemDragging already flipped false), so resync explicitly here.
			localItems = [...(group.items as ZoneItem[])];
			return;
		}

		const committed = items as LayoutItem[];
		localItems = committed as ZoneItem[];
		onFinalize(committed);
	}

	// Collapsed height of a placed card, read off any card on the canvas: an expanded card is
	// taller, so take its header row plus the card's own padding and border.
	function placedItemHeight(): number {
		const header = document.querySelector<HTMLElement>('[data-builder-item-header]');
		const card = header?.closest<HTMLElement>('[data-slot="card"]');
		if (!header || !card) return 0;
		const style = getComputedStyle(card);
		const chrome = ['paddingTop', 'paddingBottom', 'borderTopWidth', 'borderBottomWidth'] as const;
		return chrome.reduce((sum, key) => sum + parseFloat(style[key]), header.offsetHeight);
	}

	function gridColumnFor(item: ZoneItem): string {
		const columns = group.columns ?? 1;
		if (item[SHADOW_ITEM_MARKER_PROPERTY_NAME]) {
			return draggedSpan >= columns ? '1 / -1' : `span ${draggedSpan}`;
		}
		if ('type' in item && item.type === 'linebreak') return '1 / -1';
		if ('type' in item && (item.type === 'input' || item.type === 'output')) {
			const span = (item as InputLayoutItem | OutputLayoutItem).span ?? 1;
			return `span ${Math.min(Math.max(1, span), columns)}`;
		}
		return 'span 1';
	}

	function toggleCollapsed() {
		onEdit(() => (group.collapsed = !group.collapsed));
	}
</script>

<Card.Root
	class="group bg-muted gap-0 overflow-hidden border-2 py-0 {isDndTarget ? 'border-primary' : ''}"
>
	<Card.Header
		class="border-border bg-card flex flex-row items-center justify-between gap-2 space-y-0 border-b px-3 py-3 transition-colors"
	>
		<!-- Drag Handle (group-level) — TabEditor declares the dragHandleZone. -->
		<div
			use:dragHandle
			class="text-muted-foreground hover:text-foreground hover:bg-accent flex cursor-grab rounded-sm p-1 opacity-40 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
			role="button"
			tabindex="0"
			aria-label="Drag to reorder"
		>
			<GripVertical size={16} />
		</div>
		<div class="flex flex-1 items-center gap-1.5">
			<div class="flex flex-1 flex-col gap-0.5">
				<div class="flex items-center gap-1">
					<button
						type="button"
						class="text-muted-foreground hover:text-foreground hover:bg-accent/50 flex h-6 w-6 shrink-0 items-center justify-center rounded-sm transition-transform duration-200 {group.collapsed
							? ''
							: 'rotate-180'}"
						onclick={toggleCollapsed}
						aria-label={group.collapsed ? 'Expand group' : 'Collapse group'}
					>
						<ChevronDown size={16} />
					</button>
					<input
						type="text"
						bind:value={
							() => group.label,
							(label) => onEdit(() => (group.label = label), `group-label:${group.id}`)
						}
						class="text-foreground hover:border-border focus:border-primary flex-1 rounded-sm border border-transparent bg-transparent px-1.5 py-0.5 text-base font-semibold focus:outline-none"
						placeholder="Group name"
					/>
				</div>

				<input
					type="text"
					bind:value={
						() => group.description,
						(description) =>
							onEdit(() => (group.description = description), `group-description:${group.id}`)
					}
					class="text-muted-foreground hover:border-border focus:border-primary ml-7 flex-1 rounded-sm border border-transparent bg-transparent px-1.5 py-0.5 text-xs focus:outline-none"
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
						bind:value={
							() => group.columns,
							(columns) => onEdit(() => (group.columns = columns), `group-columns:${group.id}`)
						}
						min="1"
						max="4"
						class="border-border bg-background text-foreground w-10 rounded-sm border px-1 py-0.5 text-xs"
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
				<div class="bg-card mt-2 rounded-sm p-2">
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
			<div class="relative">
				<div
					use:dragHandleZone={{
						items: localItems,
						type: DND_TYPE_PARAM,
						flipDurationMs: DND_FLIP_MS,
						dropTargetClasses: ['ring-1', 'ring-primary/30'],
						dropTargetStyle: {},
						// The library aims with the clone's centre, not the pointer. Centred, a full-width
						// item can still target one column of a grid once it shrinks to the cell.
						centreDraggedOnCursor: true,
						transformDraggedElement: liftDraggedElement
					}}
					onconsider={handleConsider}
					onfinalize={handleFinalize}
					class="grid min-h-14 content-start items-start gap-3 rounded-lg transition-all
						{group.items.length === 0 ? 'border-border min-h-15 border-2 border-dashed p-3' : ''}"
					style="grid-template-columns: repeat({group.columns}, 1fr);"
				>
					{#each localItems as item (item.id)}
						<div
							animate:flip={{ duration: DND_FLIP_MS }}
							style="grid-column: {gridColumnFor(item)}"
						>
							{#if item[SHADOW_ITEM_MARKER_PROPERTY_NAME]}
								<!-- dndzone hides the shadow's outer div; the inner one opts back in. -->
								<div
									style:--ghost-h="{ghostHeight || 48}px"
									class="border-primary/40 bg-primary/5 pointer-events-none visible h-(--ghost-h) rounded-lg border-2 border-dashed"
								></div>
							{:else if 'type' in item && item.type === 'linebreak'}
								<LineBreakItem
									item={item as LineBreakLayoutItem}
									onRemove={() => onRemoveItem(item.id)}
								/>
							{:else if 'type' in item && (item.type === 'input' || item.type === 'output')}
								{@const idx = localItems.indexOf(item)}
								{@const layoutItem = item as InputLayoutItem | OutputLayoutItem}
								<BuilderGroupItem
									bind:item={localItems[idx] as InputLayoutItem | OutputLayoutItem}
									paramInfo={getParameterInfo(layoutItem.paramId)}
									columns={group.columns}
									bind:expanded={() => isExpanded(item.id), (v) => setExpanded(item.id, v)}
									{availableInputs}
									{getParameterInfo}
									currentValue={outputValues[layoutItem.paramId]}
									onRemove={() => onRemoveItem(item.id)}
								/>
							{:else}
								<!-- Foreign sidebar item — show a neutral placeholder while hovering. -->
								<div
									class="border-primary/30 bg-primary/5 rounded-lg border-2 border-dashed p-3 text-sm opacity-70"
								>
									{('nickname' in item && item.nickname) ||
										('name' in item && (item as { name?: string }).name) ||
										'New parameter'}
								</div>
							{/if}
						</div>
					{/each}
				</div>

				{#if group.items.length === 0 && !isDndTarget}
					<div
						class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2"
					>
						<MousePointerClick size={48} class="opacity-50" />
						<span class="text-muted-foreground text-sm">Drag parameters here</span>
					</div>
				{/if}
			</div>
		</Card.Content>
	{/if}
</Card.Root>
