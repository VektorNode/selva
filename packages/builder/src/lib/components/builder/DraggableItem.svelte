<script lang="ts">
  import { dragStore } from '$lib/stores/dragStore.svelte';
  import type { AvailableParameter, DownloadableComponent } from '$lib/types/generated';
  import * as Card from '$lib/components/ui/card';

  interface Props {
    item: AvailableParameter | DownloadableComponent;
    type: 'parameter' | 'downloadable';
    category?: 'input' | 'output';
  }

  let { item, type, category }: Props = $props();

  let isDragging = $state(false);

  function handleDragStart(e: DragEvent) {
    isDragging = true;
    dragStore.set({
      dropType: type,
      data: item,
      paramCategory: type === 'downloadable' ? 'downloadable' : category,
    });

    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', item.id);
    }
  }

  function handleDragEnd() {
    isDragging = false;
    dragStore.clear();
  }

  // Determine styling based on type/category
  const bgColor = type === 'downloadable' ? 'bg-downloadparam' : category === 'input' ? 'bg-inputparam' : 'bg-outputparam';
  const badgeBg = type === 'downloadable' ? 'bg-green-100/80' : 'bg-primary/10';
  const badgeText = type === 'downloadable' ? 'text-green-700' : 'text-primary';
  const badgeContent = type === 'downloadable' ? 'File' : ('paramType' in item ? item.paramType : 'Unknown');
</script>

<Card.Root
  class={`
    mb-2 flex cursor-grab flex-row items-center
    justify-between gap-4 rounded-xl border-2 border-transparent
    p-3 transition-all hover:border-primary
    hover:bg-muted ${bgColor}
    ${isDragging ? 'cursor-grabbing opacity-50' : ''}
  `}
  draggable="true"
  role="button"
  ondragstart={handleDragStart}
  ondragend={handleDragEnd}
>
  <div class="flex flex-1 items-center gap-3">
    <strong class="text-foreground">{item.nickname || ('name' in item ? item.name : 'Unknown')}</strong>
    <span class={`rounded px-2 py-1 text-sm ${badgeBg} ${badgeText}`}>
      {badgeContent}
    </span>
  </div>
  <span class="cursor-grab font-bold text-muted-foreground select-none">⋮⋮</span>
</Card.Root>
