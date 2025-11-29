<script lang="ts">
  import { dragStore } from '$lib/stores/dragStore.svelte';
  import type { AvailableParameter, AvailableOutput } from '$lib/types/generated';
  import * as Card from '$lib/components/ui/card';

  interface Props {
    item: AvailableParameter | AvailableOutput;
  }

  let { item }: Props = $props();

  // Infer variant from item type
  const variant = 'paramType' in item ? 'input' : 'output';

  let isDragging = $state(false);

  function handleDragStart(e: DragEvent) {
    isDragging = true;

    dragStore.set({
      dropType: variant,
      data: item,
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

  const badgeContent =
    'paramType' in item ? item.paramType : (item as AvailableOutput).outputType || 'Unknown';

  // Variant-based styling
  const styles = {
    input: {
      bg: 'bg-inputparam',
      badgeBg: 'bg-primary/10',
      badgeText: 'text-primary',
    },
    output: {
      bg: badgeContent === 'print' ? 'bg-outputparam' : 'bg-downloadparam',
      badgeBg: 'bg-primary/10',
      badgeText: 'text-primary',
    },
  };
  const style = styles[variant];

  function capitalize(str: string) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
</script>

<Card.Root
  class={`
    mb-2 flex cursor-grab flex-row items-center
    justify-between gap-4 rounded-xl border-2 border-transparent
    p-3 transition-all hover:border-primary
    hover:bg-muted ${style.bg}
    ${isDragging ? 'cursor-grabbing opacity-50' : ''}
  `}
  draggable="true"
  role="button"
  ondragstart={handleDragStart}
  ondragend={handleDragEnd}
>
  <div class="flex flex-1 items-center gap-3">
    <strong class="text-foreground"
      >{item.nickname || ('name' in item ? item.name : 'Unknown')}</strong
    >
    <span class={`rounded px-2 py-1 text-sm ${style.badgeBg} ${style.badgeText}`}>
      {capitalize(badgeContent)}
    </span>
  </div>
  <span class="cursor-grab font-bold text-muted-foreground select-none">⋮⋮</span>
</Card.Root>
