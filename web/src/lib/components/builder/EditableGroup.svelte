<script lang="ts">
  import type { Snippet } from "svelte";

  import type { GroupConfig } from "$lib/types/schema";
  import { Button } from "$lib/components/ui/button";
  import DropZone from "./DropZone.svelte";
  import Trash from "../ui/icons/Trash.svelte";

  interface EditableGroupProps {
    group: GroupConfig;
    onDrop?: (event: CustomEvent) => void;
    onReorder?: (event: CustomEvent) => void;
    onRemove: () => void;
    children: Snippet;
  }

  let { group, onDrop, onReorder, onRemove, children }: EditableGroupProps =
    $props();

  let isDragOver = $state(false);

  function toggleCollapsed() {
    group.collapsed = !group.collapsed;
  }

  function handleHeaderDragOver(e: DragEvent) {
    // Auto-expand when dragging over a collapsed group
    if (group.collapsed) {
      e.preventDefault();
      isDragOver = true;
    }
  }

  function handleHeaderDragEnter(e: DragEvent) {
    if (group.collapsed) {
      isDragOver = true;
      // Auto-expand after a short delay
      setTimeout(() => {
        if (isDragOver && group.collapsed) {
          group.collapsed = false;
        }
      }, 300);
    }
  }

  function handleHeaderDragLeave() {
    isDragOver = false;
  }

  function handleReorderEvent(e: Event) {
    if (onReorder && e instanceof CustomEvent) {
      onReorder(e);
    }
  }

  function handleDropEvent(e: Event) {
    if (onDrop && e instanceof CustomEvent) {
      onDrop(e);
    }
  }

  function setupGridRef(node: HTMLDivElement) {
    if (onReorder) {
      node.addEventListener("reorder", handleReorderEvent);
    }

    if (onDrop) {
      node.addEventListener("parameterdrop", handleDropEvent);
    }

    return {
      destroy() {
        if (onReorder) {
          node.removeEventListener("reorder", handleReorderEvent);
        }
        if (onDrop) {
          node.removeEventListener("parameterdrop", handleDropEvent);
        }
      },
    };
  }
</script>

<div
  class="border-2 border-border rounded-lg bg-muted overflow-hidden {isDragOver
    ? 'border-primary'
    : ''}"
>
  <div
    class="p-4 bg-card border-b border-border flex justify-between items-start gap-4"
    ondragover={handleHeaderDragOver}
    ondragenter={handleHeaderDragEnter}
    ondragleave={handleHeaderDragLeave}
    role="button"
    tabindex="0"
  >
    <div class="flex items-start gap-2">
      <button
        type="button"
        class="text-muted-foreground hover:text-foreground transition-transform duration-200 h-[34px] flex items-center {group.collapsed
          ? ''
          : 'rotate-180'}"
        onclick={toggleCollapsed}
        aria-label={group.collapsed ? "Expand group" : "Collapse group"}
      >
        ▼
      </button>
      <div class="flex-1 flex flex-col gap-2">
        <input
          type="text"
          bind:value={group.label}
          class="font-semibold text-base border border-transparent px-2 py-1 rounded hover:border-border focus:border-primary focus:outline-none bg-transparent text-foreground"
          placeholder="Group name"
        />
        {#if !group.collapsed}
          <input
            type="text"
            bind:value={group.description}
            class="text-sm text-muted-foreground border border-transparent px-2 py-1 rounded hover:border-border focus:border-primary focus:outline-none bg-transparent"
            placeholder="Description (optional)"
          />
        {/if}
      </div>
    </div>
    <div class="flex items-center gap-4">
      {#if !group.collapsed}
        <label class="flex items-center gap-2 text-sm text-foreground">
          Columns:
          <input
            type="number"
            bind:value={group.columns}
            min="1"
            max="4"
            class="w-[50px] px-2 py-1 border border-border rounded bg-background text-foreground"
          />
        </label>
      {:else}
        <span class="text-xs text-muted-foreground">
          {group.items.length} item{group.items.length !== 1 ? "s" : ""}
        </span>
      {/if}
      <Button
        variant="ghost"
        size="icon"
        class="hover:bg-destructive hover:text-destructive-foreground"
        onclick={onRemove}><Trash /></Button
      >
    </div>
  </div>

  {#if !group.collapsed}
    <div class="p-4 animate-[fadeIn_0.2s]">
      <DropZone
        isEmpty={group.items.length === 0}
        label="Drag parameters here"
        ondrop={onDrop}
      >
        <div
          use:setupGridRef
          class="grid gap-3"
          style="grid-template-columns: repeat({group.columns}, 1fr);"
        >
          {@render children()}
        </div>
      </DropZone>
    </div>
  {/if}
</div>
