<script lang="ts">
  import { dragStore } from '$lib/stores/dragStore.svelte';
  import type { LayoutItem, DiscoveredInput, NumberWidgetConfig } from '@selva/shared';
  import { Badge, Button, Card, Switch } from '@selva/shared';
  import { ArrowDownToLine, ArrowUpFromLine, Download, ChevronDown } from '@lucide/svelte';

  interface BuilderGroupItemProps {
    item: LayoutItem;
    paramInfo?: DiscoveredInput;
    tabId: string;
    groupId: string;
    onRemove: () => void;
  }

  let { item, paramInfo, tabId, groupId, onRemove }: BuilderGroupItemProps = $props();

  let isNumberInput = $derived(item.type === 'input' && item.widgetType === 'number');
  let showAdvanced = $state(false);
  let hasAdvancedOptions = $derived(isNumberInput);

  let isDragging = $state(false);
  let isDragOver = $state(false);
  let dropPosition: 'before' | 'after' | null = $state(null);
  let canDrag = $state(true);

  function toggleSliderMode() {
    if (!isNumberInput) return;
    const config = item.config as NumberWidgetConfig;
    config.renderAsSlider = !config.renderAsSlider;
  }

  function handleDragStart(e: DragEvent) {
    if (!canDrag) return e.preventDefault();
    isDragging = true;

    dragStore.set({
      dropType: 'group-item',
      data: { item, tabId, groupId },
    });

    e.dataTransfer?.setData('text/plain', item.id);
    e.dataTransfer!.effectAllowed = 'move';
  }

  function handleDragEnd() {
    isDragging = false;
    dragStore.clear();
  }

  function handleDragOver(e: DragEvent) {
    const dragData = dragStore.current;

    // Only show indicators for item/input/output drags (not group drags)
    // Group drags don't set dragStore, so this naturally filters them out
    if (!dragData || !['group-item', 'input', 'output'].includes(dragData.dropType)) return;

    e.preventDefault();
    e.stopPropagation();
    isDragOver = true;

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    dropPosition = e.clientY < midpoint ? 'before' : 'after';

    e.dataTransfer!.dropEffect = dragData.dropType === 'group-item' ? 'move' : 'copy';
  }

  function handleDragLeave(e: DragEvent) {
    // Only clear if leaving the card itself, not child elements
    const relatedTarget = e.relatedTarget as Node | null;
    const currentTarget = e.currentTarget as Node;
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      isDragOver = false;
      dropPosition = null;
    }
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDragOver = false;

    const dragData = dragStore.current;
    if (!dragData) return;

    const detail =
      dragData.dropType === 'group-item'
        ? {
            sourceItem: dragData.data.item,
            sourceTabId: dragData.data.tabId,
            sourceGroupId: dragData.data.groupId,
            targetItem: item,
            targetTabId: tabId,
            targetGroupId: groupId,
            dropPosition: dropPosition || 'after',
          }
        : {
            dropType: dragData.dropType,
            data: dragData.data,
            targetItem: item,
            targetTabId: tabId,
            targetGroupId: groupId,
            dropPosition: dropPosition || 'after',
          };

    const event = new CustomEvent(
      dragData.dropType === 'group-item' ? 'reorder' : 'parameterdrop',
      {
        detail,
        bubbles: true,
        composed: true,
      }
    );

    (e.currentTarget as HTMLElement).dispatchEvent(event);
    dropPosition = null;
  }
</script>

<div class="relative">
  {#if isDragOver && dropPosition === 'before'}
    <div class="absolute -top-0.5 left-0 right-0 h-0.5 bg-primary rounded"></div>
  {/if}

  {#if isDragOver && dropPosition === 'after'}
    <div class="absolute -bottom-0.5 left-0 right-0 h-0.5 bg-primary rounded"></div>
  {/if}

  <Card.Root
    class={`
			cursor-grab transition-all py-1
			hover:shadow-sm hover:border-primary
			${isDragging ? 'cursor-grabbing opacity-50' : ''}
			${isDragOver ? 'border-primary' : ''}
			${item.type === 'input' ? 'bg-inputparam' : 'bg-outputparam'}
		`}
    draggable="true"
    ondragstart={handleDragStart}
    ondragend={handleDragEnd}
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
  >
    <div class="grid grid-cols-[20px_1fr] gap-3 p-2">
      <div class="flex items-start pt-0.5">
        {#if item.type === 'input'}
          <ArrowUpFromLine size={14} class="text-muted-foreground" />
        {:else}
          <ArrowDownToLine size={14} class="text-muted-foreground" />
        {/if}
      </div>

      <div class="flex flex-col gap-2">
        <!-- Display Name + Remove -->
        <div class="flex items-center gap-2">
          <input
            type="text"
            bind:value={item.displayName}
            class="flex-1 rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs font-medium
							   hover:border-border focus:border-primary focus:outline-none"
            placeholder="Display Name"
            onmousedown={() => (canDrag = false)}
            onmouseup={() => (canDrag = true)}
            onmouseleave={() => (canDrag = true)}
          />
          <Button
            variant="ghost"
            size="icon-sm"
            class="h-4 w-4 hover:bg-destructive hover:text-destructive-foreground"
            onclick={onRemove}>×</Button
          >
        </div>

        <!-- Description -->
        <input
          type="text"
          bind:value={item.description}
          class="rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-[11px] text-muted-foreground
						   hover:border-border focus:border-primary focus:outline-none"
          placeholder="Description"
          onmousedown={() => (canDrag = false)}
          onmouseup={() => (canDrag = true)}
          onmouseleave={() => (canDrag = true)}
        />

        <!-- Parameter Info / Type Badge -->
        {#if paramInfo}
          <div class="flex items-center gap-2">
            <Badge variant="default" class="px-1 py-0 text-[9px] rounded-xs">
              {paramInfo.type}
            </Badge>
            <span class="font-mono text-[9px] text-muted-foreground">
              GH: {paramInfo.nickname}
            </span>
          </div>
        {:else if item.type === 'output'}
          <div class="flex items-center gap-2">
            <Badge variant="default" class="px-1 py-0 text-[9px] rounded-xs">
              {item.widgetType}
            </Badge>
          </div>
        {/if}

        <!-- Advanced -->
        {#if hasAdvancedOptions}
          <div class="mt-1 border-t border-border/70 pt-1">
            <button
              onclick={() => (showAdvanced = !showAdvanced)}
              class="flex w-full items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground mb-2"
            >
              <ChevronDown
                size={12}
                class={`transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
              />
              Advanced
            </button>

            {#if showAdvanced && isNumberInput}
              {@const config = item.config as NumberWidgetConfig}
              <div class="mt-1 flex items-center justify-between text-[11px]">
                <span class="text-muted-foreground">Slider</span>
                <Switch
                  checked={config.renderAsSlider ?? true}
                  onCheckedChange={toggleSliderMode}
                  class="scale-75"
                />
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </Card.Root>
</div>
