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
	import { dragHandle, dragHandleZone, SHADOW_ITEM_MARKER_PROPERTY_NAME } from 'svelte-dnd-action';
	import type { DndEvent } from 'svelte-dnd-action';
	import { SvelteMap } from 'svelte/reactivity';
	import {
		DND_TYPE_PARAM,
		isDiscoveredInput,
		isDiscoveredOutput
	} from '$lib/dnd/dndzone-helpers';

	type ZoneItem = (LayoutItem | DiscoveredInput | DiscoveredOutput) & {
		isDndShadowItem?: true;
	};

	interface EditableGroupProps {
		group: GroupConfig;
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

	$effect(() => {
		if (!isItemDragging) {
			localItems = [...(group.items as ZoneItem[])];
		}
	});

	// True while a placeholder is hovering the zone — used for visual highlight.
	const isDndTarget = $derived(localItems.some((i) => i.isDndShadowItem));

	function handleConsider(e: CustomEvent<DndEvent<ZoneItem>>) {
		isItemDragging = true;
		const draggedId = e.detail.info?.id;
		if (draggedId) {
			const all = [...localItems, ...(group.items as ZoneItem[])];
			const dragged = all.find((i) => i.id === draggedId && !i.isDndShadowItem);
			if (dragged && 'type' in dragged && dragged.type === 'linebreak') {
				draggedSpan = group.columns ?? 1;
			} else if (dragged && 'span' in dragged) {
				draggedSpan = (dragged as InputLayoutItem | OutputLayoutItem).span ?? 1;
			} else {
				// Foreign item from sidebar — defaults to span 1.
				draggedSpan = 1;
			}
		}
		localItems = e.detail.items;
	}

	function handleFinalize(e: CustomEvent<DndEvent<ZoneItem>>) {
		isItemDragging = false;

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
			// Process each foreign item as a positioned drop.
			for (const idx of foreignIndices) {
				const foreign = items[idx];
				// Find the nearest neighbour LayoutItem to anchor the drop.
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
			// Resync local from group.items — onParameterDrop will have mutated it.
			// (The $effect won't fire mid-handler because isItemDragging flipped to false,
			// but localItems was just set from e.detail; we explicitly resync here.)
			localItems = [...(group.items as ZoneItem[])];
			return;
		}

		// All items are LayoutItems — pure reorder.
		const committed = items as LayoutItem[];
		localItems = committed as ZoneItem[];
		onFinalize(committed);
	}

	function toggleCollapsed() {
		group.collapsed = !group.collapsed;
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
			class="text-muted-foreground hover:text-foreground hover:bg-accent flex cursor-grab rounded p-1 opacity-40 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
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
			<div class="relative">
				<div
					use:dragHandleZone={{
						items: localItems,
						type: DND_TYPE_PARAM,
						flipDurationMs: 200,
						dropTargetClasses: ['ring-2', 'ring-primary'],
						dropTargetStyle: {}
					}}
					onconsider={handleConsider}
					onfinalize={handleFinalize}
					class="grid min-h-14 items-start gap-3 rounded-md transition-all
						{group.items.length === 0
						? 'border-border min-h-15 border-2 border-dashed p-3'
						: ''}"
					style="grid-template-columns: repeat({group.columns}, 1fr);"
				>
					{#each localItems as item (item.id)}
						{#if (item as ZoneItem)[SHADOW_ITEM_MARKER_PROPERTY_NAME]}
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
						{:else if 'type' in item && item.type === 'linebreak'}
							<div style="grid-column: 1 / -1;">
								<LineBreakItem
									item={item as LineBreakLayoutItem}
									onRemove={() => onRemoveItem(item.id)}
								/>
							</div>
						{:else if 'type' in item && (item.type === 'input' || item.type === 'output')}
							{@const idx = localItems.indexOf(item)}
							{@const layoutItem = item as InputLayoutItem | OutputLayoutItem}
							<div
								style="grid-column: span {Math.min(
									Math.max(1, layoutItem.span ?? 1),
									group.columns ?? 1
								)}"
							>
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
							</div>
						{:else}
							<!-- Foreign sidebar item — show a neutral placeholder while hovering. -->
							<div style="grid-column: span 1">
								<div
									class="border-primary/30 bg-primary/5 rounded border-2 border-dashed p-3 text-sm opacity-70"
								>
									{('nickname' in item && item.nickname) ||
										('name' in item && (item as { name?: string }).name) ||
										'New parameter'}
								</div>
							</div>
						{/if}
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
