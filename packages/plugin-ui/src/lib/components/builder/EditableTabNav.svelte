<script lang="ts">
	import type { TabConfig } from '@selvajs/schemas';
	import { GripVertical, Plus } from '@lucide/svelte';
	import { Button } from '@selvajs/ui';
	import TabIcon from './TabIcon.svelte';
	import {
		dragHandle,
		dragHandleZone,
		SHADOW_ITEM_MARKER_PROPERTY_NAME,
		TRIGGERS
	} from 'svelte-dnd-action';
	import type { DndEvent } from 'svelte-dnd-action';
	import { flip } from 'svelte/animate';
	import {
		DND_FLIP_MS,
		DND_TYPE_TAB,
		draggedItemMove,
		liftDraggedElement
	} from '#lib/dnd/dndzone-helpers.js';
	import { captureDragFootprint, dragFootprint } from '#lib/dnd/drag-footprint.svelte.js';

	interface EditableTabNavProps {
		tabs: TabConfig[];
		activeTabId: string | null;
		onTabChange: (tabId: string) => void;
		onAddTab: () => void;
		onReorderTabs?: (fromIndex: number, toIndex: number) => void;
		/**
		 * True while a group is being dragged elsewhere. While true, hovering
		 * a tab header marks it as the pending move target (no actual switch
		 * — switching mid-drag would terminate the dndzone drag).
		 */
		groupDragActive?: boolean;
		/**
		 * Notifies the parent which tab the cursor is hovering during a group
		 * drag. Pass null when no tab is hovered. Drives the live tab highlight
		 * and (on release) the cross-tab move target.
		 */
		onPendingTargetChange?: (tabId: string | null) => void;
	}

	let {
		tabs,
		activeTabId,
		onTabChange,
		onAddTab,
		onReorderTabs,
		groupDragActive = false,
		onPendingTargetChange
	}: EditableTabNavProps = $props();

	type ZoneTab = TabConfig & { isDndShadowItem?: true };

	// Local mirror so dndzone can render the shadow placeholder during reorder.
	let localTabs = $state<ZoneTab[]>([]);
	let isTabDragging = $state(false);

	$effect(() => {
		if (!isTabDragging) {
			localTabs = [...(tabs as ZoneTab[])];
		}
	});

	function handleConsider(e: CustomEvent<DndEvent<ZoneTab>>) {
		captureDragFootprint(e, localTabs);
		isTabDragging = true;
		localTabs = e.detail.items;
	}

	function handleFinalize(e: CustomEvent<DndEvent<ZoneTab>>) {
		isTabDragging = false;
		const items = e.detail.items;

		// A tab was dragged out into another zone — this zone stays source-only, no reorder.
		if (e.detail.info?.trigger === TRIGGERS.DROPPED_INTO_ANOTHER) {
			localTabs = [...(tabs as ZoneTab[])];
			return;
		}

		const committed = items.filter((it) => !it.isDndShadowItem) as TabConfig[];
		const move = draggedItemMove(
			tabs.map((t) => t.id),
			committed.map((t) => t.id),
			e.detail.info.id
		);

		localTabs = committed as ZoneTab[];

		if (move) onReorderTabs?.(move.from, move.to);
	}

	// svelte-dnd-action's dragged clone sits over the cursor and absorbs pointer
	// events, so onpointerenter on a tab never fires during a group drag. Instead,
	// track pointermove globally and use elementsFromPoint (which sees through the
	// clone) to find the hovered tab. Never call onTabChange here — switching the
	// active tab mid-drag swaps DOM in the destination's dndzone and kills the
	// drag. Surface the hovered id to the parent instead; it commits the
	// cross-tab move on finalize.
	let pendingTargetTabId: string | null = $state(null);
	let tabRefs = $state<Record<string, HTMLElement>>({});

	function trackTabEl(node: HTMLElement, tabId: string) {
		tabRefs[tabId] = node;
		return {
			destroy() {
				delete tabRefs[tabId];
			}
		};
	}

	function setPendingTarget(tabId: string | null) {
		if (pendingTargetTabId === tabId) return;
		pendingTargetTabId = tabId;
		onPendingTargetChange?.(tabId);
	}

	function handleGlobalPointerMove(e: PointerEvent) {
		const stack = document.elementsFromPoint(e.clientX, e.clientY);
		for (const el of stack) {
			for (const [tabId, tabEl] of Object.entries(tabRefs)) {
				if (tabEl && (tabEl === el || tabEl.contains(el))) {
					// Only mark as pending if it's not the source/active tab —
					// hovering the source is a no-op move.
					setPendingTarget(tabId === activeTabId ? null : tabId);
					return;
				}
			}
		}
		setPendingTarget(null);
	}

	$effect(() => {
		if (!groupDragActive) {
			setPendingTarget(null);
			return;
		}
		document.addEventListener('pointermove', handleGlobalPointerMove);
		return () => {
			document.removeEventListener('pointermove', handleGlobalPointerMove);
			setPendingTarget(null);
		};
	});
</script>

<div class="border-border flex items-end gap-1 border-b px-2">
	<div
		use:dragHandleZone={{
			items: localTabs,
			type: DND_TYPE_TAB,
			flipDurationMs: DND_FLIP_MS,
			dropFromOthersDisabled: true,
			dropTargetStyle: {},
			transformDraggedElement: liftDraggedElement
		}}
		onconsider={handleConsider}
		onfinalize={handleFinalize}
		class="no-scrollbar flex min-w-0 items-end gap-1 overflow-x-auto"
	>
		{#each localTabs as tab (tab.id)}
			<div animate:flip={{ duration: DND_FLIP_MS }} class="shrink-0">
				{#if tab[SHADOW_ITEM_MARKER_PROPERTY_NAME]}
					<div
						style:--ghost-w="{dragFootprint.width || 120}px"
						class="border-primary/40 bg-primary/5 visible h-10 w-(--ghost-w) rounded-t-lg border-2 border-dashed"
					></div>
				{:else}
					{@const isActive = activeTabId === tab.id}
					<div
						use:trackTabEl={tab.id}
						class="group/tab relative flex h-10 items-center rounded-t-lg transition-colors {pendingTargetTabId ===
						tab.id
							? 'bg-primary/10 ring-primary ring-2 ring-inset'
							: 'hover:bg-muted/60'}"
						role="presentation"
					>
						{#if onReorderTabs}
							<div
								use:dragHandle
								class="text-muted-foreground/60 hover:text-foreground flex cursor-grab items-center self-stretch pl-1.5 opacity-0 transition-opacity group-hover/tab:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
								role="button"
								tabindex="0"
								aria-label="Drag to reorder tab"
							>
								<GripVertical size={14} />
							</div>
						{/if}
						<button
							type="button"
							class="flex max-w-56 items-center gap-2 py-2 pr-3 pl-1 text-sm font-medium whitespace-nowrap transition-colors {isActive
								? 'text-foreground'
								: 'text-muted-foreground hover:text-foreground'} {tab.visible === false
								? 'line-through opacity-60'
								: ''}"
							onclick={() => onTabChange(tab.id)}
							aria-pressed={isActive}
						>
							<TabIcon icon={tab.icon} />
							<span class="min-w-0 truncate">{tab.label || 'Untitled tab'}</span>
						</button>
						{#if isActive}
							<span class="bg-primary absolute inset-x-2 bottom-0 h-0.5 rounded-full"></span>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
	<div class="shrink-0 pb-1">
		<Button variant="ghost" size="icon-sm" onclick={onAddTab} aria-label="Add tab" title="Add tab">
			<Plus />
		</Button>
	</div>
</div>
