<script lang="ts">
  import { dragStore } from '$lib/stores/dragStore.svelte';
  import type { DownloadableComponent } from '$lib/types/generated';
  import * as Card from '$lib/components/ui/card';

  interface Props {
    component: DownloadableComponent;
  }

  let { component }: Props = $props();

  let isDragging = $state(false);

  function handleDragStart(e: DragEvent) {
    isDragging = true;
    dragStore.set({
      dropType: 'downloadable',
      data: component,
      paramCategory: 'downloadable',
    });

    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', component.id);
    }
  }

  function handleDragEnd() {
    isDragging = false;
    dragStore.clear();
  }
</script>

<Card.Root
  class={`
    mb-2 flex cursor-grab flex-row items-center
    justify-between gap-4 rounded-xl border-2 border-transparent
    p-3 transition-all hover:border-primary
    hover:bg-muted bg-downloadparam
    ${isDragging ? 'cursor-grabbing opacity-50' : ''}
  `}
  draggable="true"
  role="button"
  ondragstart={handleDragStart}
  ondragend={handleDragEnd}
>
  <div class="flex flex-1 items-center gap-3">
    <strong class="text-foreground">{component.nickname}</strong>
    <span class="rounded bg-green-100/80 px-2 py-1 text-sm text-green-700"> File </span>
  </div>
  <span class="cursor-grab font-bold text-muted-foreground select-none">⋮⋮</span>
</Card.Root>
