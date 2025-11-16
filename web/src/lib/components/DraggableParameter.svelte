<script lang="ts">
  import { dragStore } from './DragDropContext.svelte';
  import type { AvailableParameter } from '$lib/types/schema';

  export let parameter: AvailableParameter;
  export let category: 'input' | 'output';

  let isDragging = false;

  function handleDragStart(e: DragEvent) {
    isDragging = true;
    dragStore.set({
      type: 'parameter',
      data: parameter,
      sourceType: category
    });

    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', parameter.id);
    }
  }

  function handleDragEnd() {
    isDragging = false;
    dragStore.set(null);
  }
</script>

<div
  class="draggable-parameter"
  class:dragging={isDragging}
  draggable="true"
  role="button"
  tabindex="0"
  on:dragstart={handleDragStart}
  on:dragend={handleDragEnd}
>
  <div class="param-info">
    <strong>{parameter.nickname || parameter.name}</strong>
    <span class="type">{parameter.paramType}</span>
  </div>
  <span class="drag-handle">⋮⋮</span>
</div>

<style>
  .draggable-parameter {
    padding: 0.75rem;
    background: #f9f9f9;
    border-radius: 4px;
    margin-bottom: 0.5rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    cursor: grab;
    transition: all 0.2s;
    border: 2px solid transparent;
  }

  .draggable-parameter:hover {
    background: #f0f0f0;
    border-color: #1976d2;
  }

  .draggable-parameter.dragging {
    opacity: 0.5;
    cursor: grabbing;
  }

  .param-info {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    flex: 1;
  }

  .type {
    background: #e3f2fd;
    color: #1976d2;
    padding: 0.25rem 0.5rem;
    border-radius: 3px;
    font-size: 0.85rem;
  }

  .drag-handle {
    color: #999;
    font-weight: bold;
    cursor: grab;
    user-select: none;
  }

  .draggable-parameter:active .drag-handle {
    cursor: grabbing;
  }
</style>
