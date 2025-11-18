<script lang="ts">
  import type { Snippet } from "svelte";
  import { dragStore } from "$lib/stores/dragStore.svelte";
  import Drop from "../ui/icons/Drop.svelte";

  interface Props {
    acceptTypes?: string[];
    label?: string;
    isEmpty?: boolean;
    ondrop?: (e: CustomEvent) => void;
    children: Snippet;
  }

  let {
    acceptTypes = ["parameter", "group-item"],
    label = "Drop here",
    isEmpty = false,
    ondrop,
    children,
  }: Props = $props();

  let isOver = $state(false);

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    const dragData = dragStore.current;

    if (dragData && acceptTypes.includes(dragData.type)) {
      isOver = true;
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
    }
  }

  function handleDragLeave() {
    isOver = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isOver = false;

    const dragData = dragStore.current;
    if (dragData && acceptTypes.includes(dragData.type)) {
      ondrop?.(new CustomEvent("drop", { detail: dragData }));
    }
  }
</script>

<div
  class={`
    min-h-[60px] border-2 border-dashed rounded-md p-3 transition-all
    ${isOver ? "border-primary bg-primary/10" : "border-border"}
    ${isEmpty ? "flex items-center justify-center" : ""}
  `}
  role="region"
  aria-label={label}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  {#if isEmpty}
    <div class="flex flex-col items-center gap-2">
      <span class="text-4xl opacity-50"><Drop /></span>
      <span class="text-sm text-muted-foreground">{label}</span>
    </div>
  {:else}
    {@render children?.()}
  {/if}
</div>
