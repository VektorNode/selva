<script lang="ts">
	import { tick } from 'svelte';
	import type { TabConfig } from '@selva/shared';
	import { GripVertical, Pencil } from '@lucide/svelte';

	interface EditableTabNavProps {
		tabs: TabConfig[];
		activeTabId: string | null;
		onTabChange: (tabId: string) => void;
		onRemoveTab: (tabId: string) => void;
		onReorderTabs?: (fromIndex: number, toIndex: number) => void;
	}

	let { tabs, activeTabId, onTabChange, onRemoveTab, onReorderTabs }: EditableTabNavProps =
		$props();

	// track which tab is currently being edited and the temporary edit text
	let editingTabId: string | null = $state(null);
	let editValue = $state('');
	let editInputEl: HTMLInputElement | null = $state(null);

	// drag state
	let draggedTabId: string | null = $state(null);
	let dragOverTabId: string | null = $state(null);
	let dragHandleRefs = $state<Record<string, HTMLDivElement | null>>({});

	function dragHandleAction(node: HTMLDivElement, tabId: string) {
		dragHandleRefs[tabId] = node;
		return {
			destroy() {
				delete dragHandleRefs[tabId];
			}
		};
	}

	function startEdit(tab: TabConfig) {
		editingTabId = tab.id;
		editValue = tab.label ?? '';
		// wait for input to appear in DOM then focus it
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

	function handleDragStart(e: DragEvent, tabId: string) {
		draggedTabId = tabId;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', tabId);
		}
	}

	function handleDragOver(e: DragEvent, tabId: string) {
		e.preventDefault();
		if (draggedTabId && draggedTabId !== tabId) {
			dragOverTabId = tabId;
			if (e.dataTransfer) {
				e.dataTransfer.dropEffect = 'move';
			}
		}
	}

	function handleDragLeave() {
		dragOverTabId = null;
	}

	function handleDrop(e: DragEvent, targetTabId: string) {
		e.preventDefault();

		if (!draggedTabId || !onReorderTabs) return;

		const fromIndex = tabs.findIndex((t) => t.id === draggedTabId);
		const toIndex = tabs.findIndex((t) => t.id === targetTabId);

		if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
			onReorderTabs(fromIndex, toIndex);
		}

		draggedTabId = null;
		dragOverTabId = null;
	}

	function handleDragEnd() {
		draggedTabId = null;
		dragOverTabId = null;
	}
</script>

<div class="border-border mb-4 flex items-end gap-2 overflow-x-auto border-b">
	{#each tabs as tab (tab.id)}
		<div
			class="group relative flex items-center rounded-t-lg bg-transparent"
			ondragover={(e) => handleDragOver(e, tab.id)}
			ondragleave={handleDragLeave}
			ondrop={(e) => handleDrop(e, tab.id)}
			role="group"
			tabindex="-1"
		>
			<!-- Drag Handle (only visible when reordering is enabled and not editing) -->
			{#if onReorderTabs && editingTabId !== tab.id}
				<div
					use:dragHandleAction={tab.id}
					class="text-muted-foreground hover:text-foreground hover:bg-accent flex cursor-grab items-center rounded p-1 active:cursor-grabbing"
					role="button"
					tabindex="0"
					aria-label="Drag to reorder tab"
					draggable="true"
					ondragstart={(e) => handleDragStart(e, tab.id)}
					ondragend={handleDragEnd}
				>
					<GripVertical size={14} />
				</div>
			{/if}

			<!-- Main clickable area: switches tabs -->
			<button
				type="button"
				class={`flex max-w-60 min-w-27.5 items-center gap-2 rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition-all ${
					editingTabId === tab.id ? 'select-text' : 'select-none'
				} ${
					activeTabId === tab.id
						? 'border-primary bg-card text-primary shadow-sm'
						: 'text-muted-foreground hover:bg-muted hover:text-foreground border-transparent'
				} ${draggedTabId === tab.id ? 'opacity-50' : ''} ${dragOverTabId === tab.id ? 'border-l-primary border-l-4' : ''}`}
				onclick={() => onTabChange(tab.id)}
				aria-pressed={activeTabId === tab.id}
				title="Switch to tab"
			>
				{#if tab.icon}
					<span class="shrink-0 text-base">
						{tab.icon}
					</span>
				{/if}

				<!-- Show label or input if editing -->
				{#if editingTabId === tab.id}
					<input
						bind:this={editInputEl}
						class="border-border bg-background text-foreground w-35 truncate rounded border px-2 py-1 text-sm focus:outline-none"
						bind:value={editValue}
						onkeydown={(e) => onEditKeydown(e, tab)}
						onblur={() => saveEdit(tab)}
						aria-label="Edit tab label"
					/>
				{:else}
					<span class="min-w-0 truncate">{tab.label}</span>
				{/if}
			</button>

			<!-- Edit button (separate from the main button) -->
			<button
				type="button"
				class="bg-muted text-muted-foreground hover:bg-accent focus:ring-ring ml-2 flex h-7 w-7 items-center justify-center rounded-full text-xs transition-colors focus:ring-2 focus:outline-none"
				onclick={() => startEdit(tab)}
				title="Edit tab label"
				aria-label="Edit tab label"
			>
				<Pencil size={14} />
			</button>

			<!-- Remove button -->
			<button
				type="button"
				class="bg-muted text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus:ring-ring ml-1 flex h-7 w-7 items-center justify-center rounded-full text-xs transition-colors focus:ring-2 focus:outline-none"
				onclick={() => onRemoveTab(tab.id)}
				title="Remove tab"
				aria-label="Remove tab"
			>
				×
			</button>
		</div>
	{/each}
</div>
