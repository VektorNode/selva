<script lang="ts">
  import { dragStore } from "$lib/stores/dragStore.svelte";
  import type { AvailableParameter } from "$lib/types/schema";
  import { inputColor, outputColor } from "../styles";

  interface Props {
    parameter: AvailableParameter;
    category: "input" | "output";
  }

  let { parameter, category }: Props = $props();

  let isDragging = $state(false);

  function handleDragStart(e: DragEvent) {
    isDragging = true;
    dragStore.set({
      type: "parameter",
      data: parameter,
      sourceType: category,
    });

    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData("text/plain", parameter.id);
    }
  }

  function handleDragEnd() {
    isDragging = false;
    dragStore.clear();
  }
</script>

<div
  class={`
    p-3 rounded-xl border-2 border-transparent mb-2
    flex justify-between items-center gap-4
    cursor-grab hover:bg-gray-100 hover:border-blue-500
    transition-all ${category === "input" ? inputColor : outputColor}
    ${isDragging ? "opacity-50 cursor-grabbing" : ""}
  `}
  draggable="true"
  role="button"
  tabindex="0"
  ondragstart={handleDragStart}
  ondragend={handleDragEnd}
>
  <div class="flex gap-3 items-center flex-1">
    <strong>{parameter.nickname || parameter.name}</strong>
    <span class="bg-blue-50 text-blue-500 px-2 py-1 rounded text-sm">
      {parameter.paramType}
    </span>
  </div>
  <span class="text-gray-400 font-bold cursor-grab select-none">⋮⋮</span>
</div>
