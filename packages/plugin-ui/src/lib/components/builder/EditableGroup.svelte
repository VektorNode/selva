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
	import VisibilityRulesDialog from './VisibilityRulesDialog.svelte';
	import {
		dragHandle,
		dragHandleZone,
		SHADOW_ITEM_MARKER_PROPERTY_NAME,
		TRIGGERS
	} from 'svelte-dnd-action';
	import type { DndEvent } from 'svelte-dnd-action';
	import { flip } from 'svelte/animate';
	import type { SvelteSet } from 'svelte/reactivity';
	import {
		DND_FLIP_MS,
		DND_TYPE_PARAM,
		isDiscoveredInput,
		isDiscoveredOutput,
		liftWithCount
	} from '#lib/dnd/dndzone-helpers.js';
	import { builderSelection } from '#lib/features/builder/selection.svelte.js';
	import { captureDragFootprint, dragFootprint } from '#lib/dnd/drag-footprint.svelte.js';

	type ZoneItem = (LayoutItem | DiscoveredInput | DiscoveredOutput) & {
		isDndShadowItem?: true;
	};

	interface EditableGroupProps {
		group: GroupConfig;
		/** Runs `apply` as an undoable draft edit; see `editDraft`. */
		onEdit: (apply: () => void, coalesceKey?: string) => void;
		onFinalize: (items: LayoutItem[]) => void;
		onParameterDrop?: (event: CustomEvent) => void;
		/** A selected card was dropped here from another group; the rest of the selection follows it. */
		onCarrySelection?: (anchorItemId: string) => void;
		onRemove: () => void;
		/** Group names are unique within a tab: a name a sibling has is never committed. */
		isLabelTaken: (label: string) => boolean;
		onAddLineBreak: () => void;
		onRemoveItem: (itemId: string) => void;
		/**
		 * Params selected on the Grasshopper canvas that this group doesn't hold yet. Undefined
		 * hides the button: nothing is selected there.
		 */
		/** What Add here would do with the canvas selection; undefined hides the button. */
		canvasPlacement?: { add: number; move: number };
		onAddCanvasSelection?: () => void;
		availableInputs: DiscoveredInput[];
		getParameterInfo: (paramId: string) => DiscoveredInput | undefined;
		outputValues?: Record<string, unknown>;
		/** Ids of the open item cards, held by the page so the sidebar can open one. */
		expandedItems: SvelteSet<string>;
		/**
		 * Ids of groups shown open for now. `group.collapsed` is the app's saved default, so finding
		 * an item inside a group must not flip it or dirty the schema.
		 */
		peekedGroups: SvelteSet<string>;
	}

	let {
		group = $bindable(),
		onEdit,
		onFinalize,
		onParameterDrop,
		onCarrySelection,
		onRemove,
		isLabelTaken,
		onAddLineBreak,
		onRemoveItem,
		canvasPlacement,
		onAddCanvasSelection,
		availableInputs,
		getParameterInfo,
		outputValues = {},
		expandedItems,
		peekedGroups
	}: EditableGroupProps = $props();

	const collapsed = $derived(!!group.collapsed && !peekedGroups.has(group.id));

	let labelError = $state<string | null>(null);

	function renameTo(input: HTMLInputElement) {
		const label = input.value;
		if (isLabelTaken(label)) {
			labelError = `This tab already has a group named “${label.trim()}”`;
			return;
		}
		labelError = null;
		onEdit(() => (group.label = label), `group-label:${group.id}`);
	}

	// Leaving the field with a taken name puts back the last name that was kept.
	function settleLabel(input: HTMLInputElement) {
		if (!labelError) return;
		input.value = group.label;
		labelError = null;
	}

	const visibilityRuleCount = $derived(group.visibilityCondition?.rules?.length ?? 0);
	function isExpanded(id: string) {
		return expandedItems.has(id);
	}
	function setExpanded(id: string, value: boolean) {
		if (value) expandedItems.add(id);
		else expandedItems.delete(id);
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
			builderSelection.startDrag(e.detail.info.id);
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
		const wasOrigin = isDragOrigin;
		isItemDragging = false;
		isDragOrigin = false;
		builderSelection.endDrag();

		// Released on another tab's drop list: whatever this zone thinks it received is void, and the
		// origin zone alone commits the move, so it happens once.
		if (builderSelection.tabDrop) {
			localItems = [...(group.items as ZoneItem[])];
			if (wasOrigin) builderSelection.commitTabDrop(e.detail.info.id, 'placed');
			return;
		}

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
		const draggedId = e.detail.info.id;
		const arrived =
			e.detail.info.trigger === TRIGGERS.DROPPED_INTO_ZONE &&
			!group.items.some((i) => i.id === draggedId) &&
			committed.some((i) => i.id === draggedId);
		localItems = committed as ZoneItem[];
		onFinalize(committed);
		// Deferred: the origin group commits its own finalize after this one, and moving the rest
		// first would let that commit write the moved cards back.
		if (arrived && builderSelection.dragSize(draggedId) > 1)
			setTimeout(() => onCarrySelection?.(draggedId));
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

	// Below this an item card's header row no longer fits, so a narrow canvas shows fewer columns
	// than the group has, the way the app itself sheds them.
	const MIN_ITEM_WIDTH = 240;
	const ITEM_GAP = 12;

	let gridWidth = $state(0);
	const shownColumns = $derived(
		gridWidth === 0
			? (group.columns ?? 1)
			: Math.max(
					1,
					Math.min(
						group.columns ?? 1,
						Math.floor((gridWidth + ITEM_GAP) / (MIN_ITEM_WIDTH + ITEM_GAP))
					)
				)
	);

	function gridColumnFor(item: ZoneItem): string {
		const columns = shownColumns;
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
		const wasPeeked = peekedGroups.delete(group.id);
		if (wasPeeked && group.collapsed) return;
		onEdit(() => (group.collapsed = !group.collapsed));
	}
</script>

<Card.Root
	data-builder-group-id={group.id}
	class="group gap-0 overflow-hidden py-0 {isDndTarget ? 'border-primary' : ''}"
>
	<Card.Header
		class="border-border bg-card flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 border-b px-3 py-3 transition-colors"
	>
		<!-- Drag Handle (group-level) — TabEditor declares the dragHandleZone. -->
		<div
			use:dragHandle
			class="text-muted-foreground hover:text-foreground hover:bg-hover flex cursor-grab rounded-sm p-1 opacity-40 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
			role="button"
			tabindex="0"
			aria-label="Drag to reorder"
		>
			<GripVertical size={16} />
		</div>
		<div class="flex min-w-40 flex-1 items-center gap-1.5">
			<div class="flex min-w-0 flex-1 flex-col gap-0.5">
				<div class="flex items-center gap-1">
					<button
						type="button"
						class="text-muted-foreground hover:text-foreground hover:bg-hover flex h-6 w-6 shrink-0 items-center justify-center rounded-sm transition-transform duration-200 {collapsed
							? ''
							: 'rotate-180'}"
						onclick={toggleCollapsed}
						aria-label={collapsed ? 'Expand group' : 'Collapse group'}
					>
						<ChevronDown size={16} />
					</button>
					<input
						type="text"
						value={group.label}
						oninput={(e) => renameTo(e.currentTarget)}
						onblur={(e) => settleLabel(e.currentTarget)}
						class="text-foreground hover:border-border focus:border-primary aria-invalid:border-destructive min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-1.5 py-0.5 text-base font-semibold focus:outline-none"
						placeholder="Group name"
						aria-label="Group name"
						aria-invalid={labelError ? true : undefined}
						aria-describedby={labelError ? `group-name-error-${group.id}` : undefined}
					/>
				</div>
				{#if labelError}
					<p id="group-name-error-{group.id}" class="text-destructive ml-7 px-1.5 text-xs">
						{labelError}
					</p>
				{/if}

				<input
					type="text"
					bind:value={
						() => group.description,
						(description) =>
							onEdit(() => (group.description = description), `group-description:${group.id}`)
					}
					class="text-muted-foreground hover:border-border focus:border-primary ml-7 min-w-0 flex-1 rounded-sm border border-transparent bg-transparent px-1.5 py-0.5 text-xs focus:outline-none"
					placeholder="Description"
					aria-label="Group description"
				/>
			</div>
		</div>
		<div class="ml-auto flex items-center gap-2">
			{#if canvasPlacement}
				{@const { add, move } = canvasPlacement}
				<Button
					variant="outline"
					size="xs"
					disabled={add + move === 0}
					title="Place the params selected on the Grasshopper canvas in this group"
					onclick={onAddCanvasSelection}
				>
					{#if move === 0}
						Add here ({add})
					{:else if add === 0}
						Move here ({move})
					{:else}
						Add {add}, move {move} here
					{/if}
				</Button>
			{/if}
			{#if !collapsed}
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
			<VisibilityRulesDialog subject={group.label || 'Group'} ruleCount={visibilityRuleCount}>
				<VisibilityRulesEditor
					bind:visibilityCondition={group.visibilityCondition}
					{availableInputs}
					currentParamInfo={undefined}
					{getParameterInfo}
					isGroupCondition={true}
				/>
			</VisibilityRulesDialog>
			<Button variant="ghost" size="icon-lg" onclick={onRemove} aria-label="Delete group">
				<Trash2 size={16} />
			</Button>
		</div>
	</Card.Header>

	{#if !collapsed}
		<Card.Content class="bg-muted animate-[fadeIn_0.2s] p-3">
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
						transformDraggedElement: (el, data) =>
							liftWithCount(el, builderSelection.dragSize((data as ZoneItem).id))
					}}
					onconsider={handleConsider}
					onfinalize={handleFinalize}
					class="grid min-h-14 content-start items-start gap-3 rounded-lg transition-all
						{group.items.length === 0 ? 'border-border min-h-15 border-2 border-dashed p-3' : ''}"
					style="grid-template-columns: repeat({shownColumns}, minmax(0, 1fr));"
					bind:clientWidth={gridWidth}
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
									class="border-primary/40 bg-primary/5 text-primary pointer-events-none visible grid h-(--ghost-h) place-items-center rounded-lg border-2 border-dashed text-xs font-medium"
								>
									{#if builderSelection.carried > 1}{builderSelection.carried} items{/if}
								</div>
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
