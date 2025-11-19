<script lang="ts">
	import { tick } from 'svelte';
	import type { TabConfig } from '$lib/types/generated';
	import Edit from '../ui/icons/Edit.svelte';

	interface EditableTabNavProps {
		tabs: TabConfig[];
		activeTabId: string | null;
		onTabChange: (tabId: string) => void;
		onRemoveTab: (tabId: string) => void;
	}

	let { tabs, activeTabId, onTabChange, onRemoveTab }: EditableTabNavProps = $props();

	// track which tab is currently being edited and the temporary edit text
	let editingTabId: string | null = $state(null);
	let editValue = $state('');
	let editInputEl: HTMLInputElement | null = $state(null);

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
</script>

<div class="mb-4 flex items-end gap-2 overflow-x-auto border-b border-border">
	{#each tabs as tab (tab.id)}
		<div class="group relative flex items-center rounded-t-lg bg-transparent">
			<!-- Main clickable area: switches tabs -->
			<button
				type="button"
				class={` flex max-w-60 min-w-[110px] items-center gap-2 rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition-all ${
					activeTabId === tab.id
						? 'border-primary bg-card text-primary shadow-sm'
						: 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
				}`}
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
						class="w-[140px] truncate rounded border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none"
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
				class="ml-2 flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground transition-colors hover:bg-accent focus:ring-2 focus:ring-ring focus:outline-none"
				onclick={() => startEdit(tab)}
				title="Edit tab label"
				aria-label="Edit tab label"
			>
				<Edit />
			</button>

			<!-- Remove button -->
			<button
				type="button"
				class="ml-1 flex h-7 w-7 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus:ring-2 focus:ring-ring focus:outline-none"
				onclick={() => onRemoveTab(tab.id)}
				title="Remove tab"
				aria-label="Remove tab"
			>
				×
			</button>
		</div>
	{/each}
</div>
