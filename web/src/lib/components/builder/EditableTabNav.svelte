<script lang="ts">
  import { tick } from "svelte";
  import type { TabConfig } from "$lib/types/schema";
  import Edit from "../ui/icons/Edit.svelte";

  interface EditableTabNavProps {
    tabs: TabConfig[];
    activeTabId: string | null;
    onTabChange: (tabId: string) => void;
    onRemoveTab: (tabId: string) => void;
  }

  let { tabs, activeTabId, onTabChange, onRemoveTab }: EditableTabNavProps =
    $props();

  // track which tab is currently being edited and the temporary edit text
  let editingTabId: string | null = $state(null);
  let editValue = $state("");
  let editInputEl: HTMLInputElement | null = $state(null);

  function startEdit(tab: TabConfig) {
    editingTabId = tab.id;
    editValue = tab.label ?? "";
    // wait for input to appear in DOM then focus it
    tick().then(() => editInputEl?.focus());
  }

  function saveEdit(tab: TabConfig) {
    if (editingTabId !== tab.id) return;
    tab.label = editValue;
    editingTabId = null;
    editValue = "";
  }

  function cancelEdit() {
    editingTabId = null;
    editValue = "";
  }

  function onEditKeydown(e: KeyboardEvent, tab: TabConfig) {
    if (e.key === "Enter") {
      saveEdit(tab);
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  }
</script>

<div class="flex gap-2 mb-4 border-b border-border overflow-x-auto items-end">
  {#each tabs as tab (tab.id)}
    <div class="group relative flex items-center bg-transparent rounded-t-lg">
      <!-- Main clickable area: switches tabs -->
      <button
        type="button"
        class={` flex items-center gap-2 px-4 py-2 text-sm rounded-t-lg border-b-2 transition-all whitespace-nowrap font-medium min-w-[110px] max-w-60 ${
          activeTabId === tab.id
            ? "border-primary text-primary bg-card shadow-sm"
            : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted"
        }`}
        onclick={() => onTabChange(tab.id)}
        aria-pressed={activeTabId === tab.id}
        title="Switch to tab"
      >
        {#if tab.icon}
          <span class="text-base shrink-0">
            {tab.icon}
          </span>
        {/if}

        <!-- Show label or input if editing -->
        {#if editingTabId === tab.id}
          <input
            bind:this={editInputEl}
            class="bg-background border border-border rounded px-2 py-1 text-sm w-[140px] truncate focus:outline-none text-foreground"
            bind:value={editValue}
            onkeydown={(e) => onEditKeydown(e, tab)}
            onblur={() => saveEdit(tab)}
            aria-label="Edit tab label"
          />
        {:else}
          <span class="truncate min-w-0">{tab.label}</span>
        {/if}
      </button>

      <!-- Edit button (separate from the main button) -->
      <button
        type="button"
        class="ml-2 flex h-7 w-7 items-center justify-center rounded-full text-xs bg-muted text-muted-foreground hover:bg-accent transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
        onclick={() => startEdit(tab)}
        title="Edit tab label"
        aria-label="Edit tab label"
      >
        <Edit />
      </button>

      <!-- Remove button -->
      <button
        type="button"
        class="ml-1 flex h-7 w-7 items-center justify-center rounded-full text-xs bg-muted text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
        onclick={() => onRemoveTab(tab.id)}
        title="Remove tab"
        aria-label="Remove tab"
      >
        ×
      </button>
    </div>
  {/each}
</div>
