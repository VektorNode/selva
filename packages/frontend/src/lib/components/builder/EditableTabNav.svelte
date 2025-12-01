<script lang="ts">
  import { tick } from 'svelte';
  import type { TabConfig } from '$lib/types/generated';
  import { Pencil } from '@lucide/svelte';

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

<div class="mb-4 flex items-end gap-2 overflow-x-auto border-b border-border">
  {#each tabs as tab (tab.id)}
    <div
      class={`group relative flex items-center rounded-t-lg bg-transparent ${
        onReorderTabs && editingTabId !== tab.id ? 'cursor-grab' : ''
      }`}
      draggable={onReorderTabs && editingTabId !== tab.id ? 'true' : 'false'}
      ondragstart={(e) => handleDragStart(e, tab.id)}
      ondragover={(e) => handleDragOver(e, tab.id)}
      ondragleave={handleDragLeave}
      ondrop={(e) => handleDrop(e, tab.id)}
      ondragend={handleDragEnd}
      role="group"
      tabindex="-1"
    >
      <!-- Main clickable area: switches tabs -->
      <button
        type="button"
        class={`flex max-w-60 min-w-[110px] items-center gap-2 rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium whitespace-nowrap transition-all ${
          editingTabId === tab.id ? 'select-text' : 'select-none'
        } ${onReorderTabs && editingTabId !== tab.id ? 'cursor-grab' : ''} ${
          activeTabId === tab.id
            ? 'border-primary bg-card text-primary shadow-sm'
            : 'border-transparent text-muted-foreground hover:bg-muted hover:text-foreground'
        } ${draggedTabId === tab.id ? 'opacity-50' : ''} ${dragOverTabId === tab.id ? 'border-l-4 border-l-primary' : ''}`}
        onclick={() => onTabChange(tab.id)}
        aria-pressed={activeTabId === tab.id}
        title={onReorderTabs ? 'Click to switch, drag to reorder' : 'Switch to tab'}
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
        <Pencil size={14} />
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
