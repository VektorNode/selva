<script lang="ts">
	import { tick } from 'svelte';
	import type { TabConfig } from 'selva-shared';
	import { GripVertical, Pencil, PanelLeft, PanelRight, ImageIcon } from '@lucide/svelte';
	import Icon from '@iconify/svelte';

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

	// icon editing state
	let editingIconTabId: string | null = $state(null);
	let editIconValue = $state('');
	let editIconInputEl: HTMLInputElement | null = $state(null);

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
			class="group relative flex items-center rounded-t-lg transition-all
				{activeTabId === tab.id ? 'bg-primary/20 shadow-md' : 'bg-muted/70 hover:bg-muted/50'}
				{draggedTabId === tab.id ? 'opacity-50' : ''}
				{dragOverTabId === tab.id ? 'ring-primary ring-2' : ''}"
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
				class=" flex max-w-60 min-w-27.5 items-center gap-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors
					{editingTabId === tab.id ? 'select-text' : 'select-none'}
					{activeTabId === tab.id
					? 'text-foreground'
					: 'text-muted-foreground hover:text-muted-foreground/80'}"
				onclick={() => onTabChange(tab.id)}
				aria-pressed={activeTabId === tab.id}
				title="Switch to tab"
			>
				{#if tab.icon}
					{#if tab.icon.includes(':')}
						<Icon icon={tab.icon} class="h-4 w-4 shrink-0" />
					{:else}
						<span class="shrink-0 text-sm leading-none font-medium">{tab.icon.slice(0, 2)}</span>
					{/if}
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

			<!-- Action buttons — visible on hover or when this tab is active -->
			<div
				class="ml-1 flex items-center gap-0.5 transition-opacity duration-150 {activeTabId ===
					tab.id || editingIconTabId === tab.id
					? 'opacity-100'
					: 'opacity-0 group-hover:opacity-100'}"
			>
				<!-- Edit label -->
				<button
					type="button"
					class="text-muted-foreground hover:bg-accent hover:text-foreground focus:ring-ring flex h-6 w-6 items-center justify-center rounded text-xs transition-colors focus:ring-2 focus:outline-none"
					onclick={() => startEdit(tab)}
					title="Edit label"
					aria-label="Edit tab label"
				>
					<Pencil size={12} />
				</button>

				<!-- Edit icon -->
				<button
					type="button"
					class="text-muted-foreground hover:bg-accent hover:text-foreground focus:ring-ring flex h-6 w-6 items-center justify-center rounded text-xs transition-colors focus:ring-2 focus:outline-none {editingIconTabId ===
					tab.id
						? 'bg-accent text-foreground'
						: ''}"
					onclick={() => (editingIconTabId === tab.id ? cancelIconEdit() : startIconEdit(tab))}
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
						tab.position = tab.position === 'right' ? undefined : 'right';
					}}
					title={tab.position === 'right'
						? 'Right panel — click to move to left'
						: 'Left panel — click to move to right'}
					aria-label="Toggle panel position"
				>
					{#if tab.position === 'right'}
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
					onclick={() => onRemoveTab(tab.id)}
					title="Remove tab"
					aria-label="Remove tab"
				>
					×
				</button>
			</div>
		</div>
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
