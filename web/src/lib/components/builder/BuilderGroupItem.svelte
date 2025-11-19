<script lang="ts">
  import { dragStore } from "$lib/stores/dragStore.svelte";
  import type {
    LayoutItem,
    AvailableParameter,
    NumberWidgetConfig,
  } from "$lib/types/schema";
  import { Badge } from "$lib/components/ui/badge";
  import { Button } from "$lib/components/ui/button";
  import * as Card from "$lib/components/ui/card";
  import { Switch } from "$lib/components/ui/switch/index.js";
  import IconOutput from "../ui/icons/IconOutput.svelte";
  import IconInput from "../ui/icons/IconInput.svelte";
  import { inputColor, outputColor } from "../styles";

  interface BuilderGroupItemProps {
    item: LayoutItem;
    paramInfo?: AvailableParameter;
    tabId: string;
    groupId: string;
    onRemove: () => void;
  }

  let { item, paramInfo, tabId, groupId, onRemove }: BuilderGroupItemProps =
    $props();

  // Check if this is a number widget
  let isNumberInput = $derived(
    item.type === "input" && item.widgetType === "number"
  );

  function toggleSliderMode() {
    if (item.type === "input" && item.widgetType === "number") {
      const config = item.config as NumberWidgetConfig;
      config.renderAsSlider = !config.renderAsSlider;
    }
  }

  let isDragging = $state(false);
  let isDragOver = $state(false);
  let dropPosition: "before" | "after" | null = $state(null);
  let canDrag = $state(true);

  function handleDragStart(e: DragEvent) {
    if (!canDrag) {
      e.preventDefault();
      return;
    }

    isDragging = true;
    dragStore.set({
      type: "group-item",
      data: { item, tabId, groupId },
      sourceType: "reorder",
    });

    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", item.id);
    }
  }

  function handleDragEnd() {
    isDragging = false;
    dragStore.clear();
  }

  function handleDragOver(e: DragEvent) {
    const dragData = dragStore.current;

    // Allow drop if dragging a group item (reorder) or a new parameter
    if (dragData?.type === "group-item" || dragData?.type === "parameter") {
      e.preventDefault(); // This must be called to allow drop
      e.stopPropagation(); // Prevent DropZone from interfering
      isDragOver = true;

      // Determine if we're in the top or bottom half of the element
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      dropPosition = e.clientY < midpoint ? "before" : "after";

      if (e.dataTransfer) {
        e.dataTransfer.dropEffect =
          dragData.type === "group-item" ? "move" : "copy";
      }
    }
  }

  function handleDragLeave() {
    isDragOver = false;
    dropPosition = null;
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation(); // Prevent DropZone from handling this drop
    isDragOver = false;

    const dragData = dragStore.current;
    if (!dragData) return;

    if (dragData.type === "group-item") {
      // Reordering existing item
      const detail = {
        sourceItem: dragData.data.item,
        sourceTabId: dragData.data.tabId,
        sourceGroupId: dragData.data.groupId,
        targetItem: item,
        targetTabId: tabId,
        targetGroupId: groupId,
        dropPosition: dropPosition || "after",
      };

      const event = new CustomEvent("reorder", {
        detail,
        bubbles: true,
        composed: true,
      });

      (e.currentTarget as HTMLElement).dispatchEvent(event);
    } else if (dragData.type === "parameter") {
      const detail = {
        type: "parameter",
        data: dragData.data,
        sourceType: dragData.sourceType,
        targetItem: item,
        targetTabId: tabId,
        targetGroupId: groupId,
        dropPosition: dropPosition || "after",
      };

      const event = new CustomEvent("parameterdrop", {
        detail,
        bubbles: true,
        composed: true,
      });

      (e.currentTarget as HTMLElement).dispatchEvent(event);
    }

    dropPosition = null;
  }
</script>

<div class="relative">
  {#if isDragOver && dropPosition === "before"}
    <div
      class="absolute -top-1 left-0 right-0 h-0.5 bg-blue-600 rounded-full z-10"
    ></div>
  {/if}
  {#if isDragOver && dropPosition === "after"}
    <div
      class="absolute -bottom-1 left-0 right-0 h-0.5 bg-blue-600 rounded-full z-10"
    ></div>
  {/if}

  <Card.Root
    class={`
      p-2 transition-all cursor-grab hover:border-primary hover:shadow-sm
      ${isDragging ? "opacity-50 cursor-grabbing" : ""}
      ${isDragOver ? "border-primary" : ""}
      ${item.type === "input" ? inputColor : outputColor}
      gap-1.5 mb-2
    `}
    draggable="true"
    role="button"
    ondragstart={handleDragStart}
    ondragend={handleDragEnd}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
  >
    <div class="flex flex-row w-full justify-between gap-2">
      <span
        class="text-muted-foreground text-[10px] cursor-grab select-none hover:text-foreground flex items-center"
      >
        <span class="text-sm">
          {#if item.type === "input"}
            <IconInput />
          {:else}
            <IconOutput />
          {/if}
        </span>
      </span>
      <div class="flex flex-1 flex-col ml-1">
        <div class="flex items-center gap-1.5 mb-1">
          <input
            type="text"
            bind:value={item.displayName}
            class="flex-1 font-medium border border-transparent px-1.5 rounded-sm text-xs hover:border-border focus:border-primary focus:outline-none bg-transparent text-foreground"
            placeholder={"Display Name"}
            onmousedown={() => (canDrag = false)}
            onmouseup={() => (canDrag = true)}
            onmouseleave={() => (canDrag = true)}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            class="h-5 w-5 hover:bg-destructive hover:text-destructive-foreground"
            onclick={onRemove}
          >
            ×
          </Button>
        </div>
        <div class="flex gap-1.5 text-xs items-center justify-between mb-1">
          <input
            type="text"
            bind:value={item.description}
            class="flex-1 text-[10px] h-6 border border-transparent px-1 py-0 rounded-sm hover:border-border focus:border-primary focus:outline-none bg-transparent text-muted-foreground"
            placeholder="Description"
            onmousedown={() => (canDrag = false)}
            onmouseup={() => (canDrag = true)}
            onmouseleave={() => (canDrag = true)}
          />
          {#if paramInfo}
            <div class="flex gap-1.5 items-center">
              <Badge variant="default" class="text-[10px] px-1.5 py-0">
                {paramInfo.paramType}
              </Badge>
              <span class="text-muted-foreground font-mono text-[10px]">
                {paramInfo.nickname}
              </span>
            </div>
          {/if}
        </div>
        {#if isNumberInput}
          {@const config = (item as any).config as NumberWidgetConfig}
          <div
            class="flex items-center gap-2 px-1.5 py-1 border-t border-border/50"
          >
            <span class="text-[10px] text-muted-foreground">Input</span>
            <Switch
              checked={config.renderAsSlider ?? true}
              onCheckedChange={toggleSliderMode}
              class="scale-75"
            />
            <span class="text-[10px] text-muted-foreground">Slider</span>
          </div>
        {/if}
      </div>
    </div></Card.Root
  >
</div>
