<script lang="ts">
  import { dragStore } from './DragDropContext.svelte';
  import { createEventDispatcher } from 'svelte';

  export let acceptTypes: string[] = ['parameter', 'group-item'];
  export let label: string = 'Drop here';
  export let isEmpty: boolean = false;

  const dispatch = createEventDispatcher();

  let isOver = false;

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    const dragData = $dragStore;

    if (dragData && acceptTypes.includes(dragData.type)) {
      isOver = true;
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    }
  }

  function handleDragLeave() {
    isOver = false;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    isOver = false;

    const dragData = $dragStore;
    if (dragData && acceptTypes.includes(dragData.type)) {
      dispatch('drop', dragData);
    }
  }
</script>

<div
  class="drop-zone"
  class:over={isOver}
  class:empty={isEmpty}
  role="region"
  aria-label={label}
  on:dragover={handleDragOver}
  on:dragleave={handleDragLeave}
  on:drop={handleDrop}
>
  {#if isEmpty}
    <div class="empty-state">
      <span class="icon">📥</span>
      <span>{label}</span>
    </div>
  {:else}
    <slot />
  {/if}
</div>

<style>
  .drop-zone {
    min-height: 60px;
    border: 2px dashed #ddd;
    border-radius: 6px;
    padding: 0.75rem;
    transition: all 0.2s;
  }

  .drop-zone.over {
    border-color: #1976d2;
    background: #e3f2fd;
  }

  .drop-zone.empty {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    color: #999;
    font-size: 0.9rem;
  }

  .icon {
    font-size: 2rem;
    opacity: 0.5;
  }
</style>
