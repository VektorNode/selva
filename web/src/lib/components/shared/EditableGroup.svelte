<script lang="ts">
  import type { Snippet } from "svelte";
  import Button from "./Button.svelte";
  import DropZone from "../DropZone.svelte";
  import type { GroupConfig } from "$lib/types/schema";

  interface EditableGroupProps {
    group: GroupConfig;
    onDrop?: (event: CustomEvent) => void;
    onReorder?: (event: CustomEvent) => void;
    onRemove: () => void;
    children: Snippet;
  }

  let { group, onDrop, onReorder, onRemove, children }: EditableGroupProps =
    $props();

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

<div class="border-2 border-gray-200 rounded-lg bg-gray-50 overflow-hidden">
  <div
    class="p-4 bg-white border-b border-gray-200 flex justify-between items-start gap-4"
  >
    <div class="flex-1 flex flex-col gap-2">
      <input
        type="text"
        bind:value={group.label}
        class="font-semibold text-base border border-transparent px-2 py-1 rounded hover:border-gray-300 focus:border-blue-600 focus:outline-none"
        placeholder="Group name"
      />
      <input
        type="text"
        bind:value={group.description}
        class="text-sm text-gray-600 border border-transparent px-2 py-1 rounded hover:border-gray-300 focus:border-blue-600 focus:outline-none"
        placeholder="Description (optional)"
      />
    </div>
    <div class="flex items-center gap-4">
      <label class="flex items-center gap-2 text-sm">
        Columns:
        <input
          type="number"
          bind:value={group.columns}
          min="1"
          max="4"
          class="w-[50px] px-2 py-1 border border-gray-300 rounded"
        />
      </label>
      <Button variant="icon" onclick={onRemove}>🗑️</Button>
    </div>
  </div>

  <div class="p-4">
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
</div>
