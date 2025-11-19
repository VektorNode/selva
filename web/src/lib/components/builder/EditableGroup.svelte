<script lang="ts">
  import type { Snippet } from "svelte";

  import type { GroupConfig } from "$lib/types/schema";
  import { Button } from "$lib/components/ui/button";
  import * as Card from "$lib/components/ui/card";
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

<Card.Root
  class="border-2 bg-muted overflow-hidden py-0 gap-0 {isDragOver
    ? 'border-primary'
    : ''}"
>
  <Card.Header
    class="px-3 py-2 bg-card border-b border-border flex flex-row justify-between items-center gap-2 space-y-0"
    ondragover={handleHeaderDragOver}
    ondragenter={handleHeaderDragEnter}
    ondragleave={handleHeaderDragLeave}
    role="button"
    tabindex={0}
  >
    <div class="flex items-center gap-1.5 flex-1">
      <div class="flex flex-col flex-1">
        <div class="">
          <button
            type="button"
            class="text-muted-foreground hover:text-foreground items-end transition-transform duration-200 text-xs {group.collapsed
              ? ''
              : 'rotate-180'}"
            onclick={toggleCollapsed}
            aria-label={group.collapsed ? "Expand group" : "Collapse group"}
          >
            ▼
          </button>
          <input
            type="text"
            bind:value={group.label}
            class="font-medium text-sm border border-transparent px-1.5 py-0.5 rounded hover:border-border focus:border-primary focus:outline-none bg-transparent text-foreground flex-1"
            placeholder="Group name"
          />
        </div>

        <input
          type="text"
          bind:value={group.description}
          class="text-xs text-muted-foreground border border-transparent px-1.5 py-0.5 rounded hover:border-border focus:border-primary focus:outline-none bg-transparent flex-1"
          placeholder="Description"
        />
      </div>
    </div>
    <div class="flex items-center gap-2">
      {#if !group.collapsed}
        <label class="flex items-center gap-1 text-xs text-muted-foreground">
          Col:
          <input
            type="number"
            bind:value={group.columns}
            min="1"
            max="4"
            class="w-10 px-1 py-0.5 text-xs border border-border rounded bg-background text-foreground"
          />
        </label>
      {:else}
        <span class="text-[10px] text-muted-foreground">
          {group.items.length}
        </span>
      {/if}
      <Button variant="ghost" size="icon-lg" onclick={onRemove}>
        <Trash />
      </Button>
    </div>
  </Card.Header>

  {#if !group.collapsed}
    <Card.Content class="p-4 animate-[fadeIn_0.2s]">
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
    </Card.Content>
  {/if}
</Card.Root>
