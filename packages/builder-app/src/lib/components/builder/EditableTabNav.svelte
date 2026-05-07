<script lang="ts">
	import { tick } from 'svelte';
	import type { TabConfig } from '@selvajs/schemas';
	import { GripVertical, Pencil, PanelLeft, PanelRight, ImageIcon } from '@lucide/svelte';
	import Icon from '@iconify/svelte';
	import {
		dragHandle,
		dragHandleZone,
		SHADOW_ITEM_MARKER_PROPERTY_NAME,
		TRIGGERS
	} from 'svelte-dnd-action';
	import type { DndEvent } from 'svelte-dnd-action';
	import { DND_TYPE_GROUP } from '$lib/dnd/dndzone-helpers';

	interface EditableTabNavProps {
		tabs: TabConfig[];
		activeTabId: string | null;
		onTabChange: (tabId: string) => void;
		onRemoveTab: (tabId: string) => void;
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
		onRemoveTab,
		onReorderTabs,
		groupDragActive = false,
		onPendingTargetChange
	}: EditableTabNavProps = $props();

	type ZoneTab = TabConfig & { isDndShadowItem?: true };

	// Tab editing state
	let editingTabId: string | null = $state(null);
	let editValue = $state('');
	let editInputEl: HTMLInputElement | null = $state(null);

	let editingIconTabId: string | null = $state(null);
	let editIconValue = $state('');
	let editIconInputEl: HTMLInputElement | null = $state(null);

	// Local mirror so dndzone can render the shadow placeholder during reorder.
	let localTabs = $state<ZoneTab[]>([]);
	let isTabDragging = $state(false);

	$effect(() => {
		if (!isTabDragging) {
			localTabs = [...(tabs as ZoneTab[])];
		}
	});

	function startEdit(tab: TabConfig) {
		editingTabId = tab.id;
		editValue = tab.label ?? '';
		tick().then(() => editInputEl?.focus());
	}

	function saveEdit(tab: TabConfig) {
		if (editingTabId !== tab.id) return;
		tab.label = editValue;
		editingTabId = null;
		editValue = '';
	}

	function cancelEdit() {
		editingTabId = null;
		editValue = '';
	}

	function onEditKeydown(e: KeyboardEvent, tab: TabConfig) {
		if (e.key === 'Enter') {
			saveEdit(tab);
		} else if (e.key === 'Escape') {
			cancelEdit();
		}
	}

	function startIconEdit(tab: TabConfig) {
		editingIconTabId = tab.id;
		editIconValue = tab.icon ?? '';
		tick().then(() => editIconInputEl?.focus());
	}

	function saveIconEdit(tab: TabConfig) {
		if (editingIconTabId !== tab.id) return;
		tab.icon = editIconValue.trim();
		editingIconTabId = null;
		editIconValue = '';
	}

	function cancelIconEdit() {
		editingIconTabId = null;
		editIconValue = '';
	}

	function onIconEditKeydown(e: KeyboardEvent, tab: TabConfig) {
		if (e.key === 'Enter') {
			saveIconEdit(tab);
		} else if (e.key === 'Escape') {
			cancelIconEdit();
		}
	}

	function handleConsider(e: CustomEvent<DndEvent<ZoneTab>>) {
		isTabDragging = true;
		localTabs = e.detail.items;
	}

	function handleFinalize(e: CustomEvent<DndEvent<ZoneTab>>) {
		isTabDragging = false;
		const items = e.detail.items;

		// Source-only: a tab was dragged out into another zone. No reorder.
		if (e.detail.info?.trigger === TRIGGERS.DROPPED_INTO_ANOTHER) {
			localTabs = [...(tabs as ZoneTab[])];
			return;
		}

		// Pure tab reorder.
		const committed = items.filter((it) => !it.isDndShadowItem) as TabConfig[];
		const oldIds = tabs.map((t) => t.id);
		const newIds = committed.map((t) => t.id);

		let from = -1;
		let to = -1;
		for (let i = 0; i < oldIds.length; i++) {
			if (oldIds[i] !== newIds[i]) {
				from = oldIds.indexOf(newIds[i]);
				to = i;
				break;
			}
		}

		localTabs = committed as ZoneTab[];

		if (from !== -1 && to !== -1 && from !== to && onReorderTabs) {
			onReorderTabs(from, to);
		}
	}

	// Hover-to-mark-pending during a group drag. svelte-dnd-action's dragged
	// clone sits over the cursor and absorbs pointer events, so onpointerenter
	// on each tab never fires. Instead, listen globally to pointermove and use
	// elementsFromPoint (which returns the stack including elements under the
	// dragged clone) to find the tab the user is hovering. We do NOT call
	// onTabChange here — switching the active tab mid-drag swaps DOM in the
	// destination's dndzone and terminates the drag. Instead, surface the
	// hovered tab id to the parent, which commits the cross-tab move on
	// finalize.
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

<div
	use:dragHandleZone={{
		items: localTabs,
		type: DND_TYPE_GROUP,
		flipDurationMs: 200,
		dropFromOthersDisabled: true,
		dropTargetStyle: {}
	}}
	onconsider={handleConsider}
	onfinalize={handleFinalize}
	class="border-border mb-4 flex items-end gap-2 overflow-x-auto border-b"
>
	{#each localTabs as tab (tab.id)}
		{#if (tab as ZoneTab)[SHADOW_ITEM_MARKER_PROPERTY_NAME]}
			<div
				class="border-primary/30 bg-primary/5 h-10 min-w-30 rounded-t-lg border-2 border-dashed"
			></div>
		{:else}
			{@const tabItem = tab as TabConfig}
			<div
				use:trackTabEl={tabItem.id}
				class="group relative flex items-center rounded-t-lg transition-all duration-150
					{activeTabId === tabItem.id ? 'bg-primary/20 shadow-md' : 'bg-muted/70 hover:bg-muted/50'}
					{pendingTargetTabId === tabItem.id
						? 'ring-primary z-10 bg-primary/40! shadow-lg ring-2 ring-inset'
						: ''}"
				role="group"
				tabindex="-1"
			>
				<!-- Drag Handle (only visible when reordering is enabled and not editing) -->
				{#if onReorderTabs && editingTabId !== tabItem.id}
					<div
						use:dragHandle
						class="text-muted-foreground hover:text-foreground hover:bg-accent flex cursor-grab items-center rounded p-1 active:cursor-grabbing"
						role="button"
						tabindex="0"
						aria-label="Drag to reorder tab"
					>
						<GripVertical size={14} />
					</div>
				{/if}

				<!-- Main clickable area: switches tabs -->
				<button
					type="button"
					class=" flex max-w-60 min-w-27.5 items-center gap-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors
						{editingTabId === tabItem.id ? 'select-text' : 'select-none'}
						{activeTabId === tabItem.id
						? 'text-foreground'
						: 'text-muted-foreground hover:text-muted-foreground/80'}"
					onclick={() => onTabChange(tabItem.id)}
					aria-pressed={activeTabId === tabItem.id}
					title="Switch to tab"
				>
					{#if tabItem.icon}
						{#if tabItem.icon.includes(':')}
							<Icon icon={tabItem.icon} class="h-4 w-4 shrink-0" />
						{:else}
							<span class="shrink-0 text-sm leading-none font-medium"
								>{tabItem.icon.slice(0, 2)}</span
							>
						{/if}
					{/if}

					<!-- Show label or input if editing -->
					{#if editingTabId === tabItem.id}
						<input
							bind:this={editInputEl}
							class="border-border bg-background text-foreground w-35 truncate rounded border px-2 py-1 text-sm focus:outline-none"
							bind:value={editValue}
							onkeydown={(e) => onEditKeydown(e, tabItem)}
							onblur={() => saveEdit(tabItem)}
							aria-label="Edit tab label"
						/>
					{:else}
						<span class="min-w-0 truncate">{tabItem.label}</span>
					{/if}
				</button>

				<!-- Action buttons — visible on hover or when this tab is active -->
				<div
					class="ml-1 flex items-center gap-0.5 transition-opacity duration-150 {activeTabId ===
						tabItem.id || editingIconTabId === tabItem.id
						? 'opacity-100'
						: 'opacity-0 group-hover:opacity-100'}"
				>
					<!-- Edit label -->
					<button
						type="button"
						class="text-muted-foreground hover:bg-accent hover:text-foreground focus:ring-ring flex h-6 w-6 items-center justify-center rounded text-xs transition-colors focus:ring-2 focus:outline-none"
						onclick={() => startEdit(tabItem)}
						title="Edit label"
						aria-label="Edit tab label"
					>
						<Pencil size={12} />
					</button>

					<!-- Edit icon -->
					<button
						type="button"
						class="text-muted-foreground hover:bg-accent hover:text-foreground focus:ring-ring flex h-6 w-6 items-center justify-center rounded text-xs transition-colors focus:ring-2 focus:outline-none {editingIconTabId ===
						tabItem.id
							? 'bg-accent text-foreground'
							: ''}"
						onclick={() =>
							editingIconTabId === tabItem.id ? cancelIconEdit() : startIconEdit(tabItem)}
						title="Edit icon"
						aria-label="Edit tab icon"
					>
						<ImageIcon size={12} />
					</button>

					<!-- Panel position toggle -->
					<button
						type="button"
						class="text-muted-foreground hover:bg-accent hover:text-foreground focus:ring-ring flex h-6 w-6 items-center justify-center rounded text-xs transition-colors focus:ring-2 focus:outline-none"
						onclick={() => {
							tabItem.position = tabItem.position === 'right' ? undefined : 'right';
						}}
						title={tabItem.position === 'right'
							? 'Right panel — click to move to left'
							: 'Left panel — click to move to right'}
						aria-label="Toggle panel position"
					>
						{#if tabItem.position === 'right'}
							<PanelRight size={12} />
						{:else}
							<PanelLeft size={12} />
						{/if}
					</button>

					<!-- Divider -->
					<div class="bg-border mx-0.5 h-4 w-px"></div>

					<!-- Remove -->
					<button
						type="button"
						class="text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus:ring-ring flex h-6 w-6 items-center justify-center rounded text-xs transition-colors focus:ring-2 focus:outline-none"
						onclick={() => onRemoveTab(tabItem.id)}
						title="Remove tab"
						aria-label="Remove tab"
					>
						×
					</button>
				</div>
			</div>
		{/if}
	{/each}
</div>
{#if editingIconTabId}
	{@const editingTab = tabs.find((t) => t.id === editingIconTabId)}
	{#if editingTab}
		<div class="bg-muted/50 border-border mb-4 rounded-md border p-3">
			<div class="mb-2 flex items-center gap-2">
				<span class="text-foreground text-sm font-medium">Icon for "{editingTab.label}"</span>
				{#if editingTab.icon}
					<span
						class="bg-background border-border flex h-6 w-6 items-center justify-center rounded border text-sm"
					>
						{#if editingTab.icon.includes(':')}
							<Icon icon={editingTab.icon} class="h-4 w-4" />
						{:else}
							<span class="text-xs font-medium">{editingTab.icon.slice(0, 2)}</span>
						{/if}
					</span>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				<input
					bind:this={editIconInputEl}
					class="border-border bg-background text-foreground focus:ring-ring w-48 rounded border px-2 py-1 text-sm focus:ring-2 focus:outline-none"
					bind:value={editIconValue}
					onkeydown={(e) => onIconEditKeydown(e, editingTab)}
					placeholder="e.g. AB or mdi:home"
					aria-label="Icon value"
				/>
				<button
					type="button"
					class="bg-primary text-primary-foreground hover:bg-primary/90 rounded px-3 py-1 text-sm transition-colors"
					onclick={() => saveIconEdit(editingTab)}
				>
					Apply
				</button>
				{#if editingTab.icon}
					<button
						type="button"
						class="text-muted-foreground hover:text-destructive text-sm transition-colors"
						onclick={() => {
							editingTab.icon = '';
							cancelIconEdit();
						}}
					>
						Clear
					</button>
				{/if}
			</div>
			<p class="text-muted-foreground mt-2 text-xs">
				Use <strong>1–2 letters</strong> (e.g. <code class="bg-muted rounded px-0.5">AB</code>) or
				an
				<a
					href="https://icon-sets.iconify.design/"
					target="_blank"
					rel="noopener noreferrer"
					class="text-primary underline">Iconify</a
				>
				icon ID (e.g. <code class="bg-muted rounded px-0.5">mdi:home</code> or
				<code class="bg-muted rounded px-0.5">solar:star-bold</code>).
			</p>
		</div>
	{/if}
{/if}
