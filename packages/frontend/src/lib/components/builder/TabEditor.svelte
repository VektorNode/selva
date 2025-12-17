<script lang="ts">
  import * as Card from '$lib/components/ui/card';
  import { Button, StateDisplay } from '$lib/components/ui';
  import { EditableTabNav, EditableGroup, BuilderGroupItem } from '$lib/components/builder';
  import type { TabConfig, DiscoveredInput } from '$lib/types/generated';
  import { dragStore } from '$lib/stores/dragStore.svelte';

  interface Props {
    tabs: TabConfig[];
    activeTabId: string | null;
    onTabChange: (tabId: string) => void;
    onAddTab: () => void;
    onRemoveTab: (tabId: string) => void;
    onReorderTabs: (fromIndex: number, toIndex: number) => void;
    onAddGroup: (tabId: string) => void;
    onRemoveGroup: (tabId: string, groupId: string) => void;
    onReorderGroups: (tabId: string, fromIndex: number, toIndex: number) => void;
    onParameterDrop: (tabId: string, groupId: string, event: CustomEvent) => void;
    onReorder: (event: CustomEvent) => void;
    onRemoveItem: (tabId: string, groupId: string, itemId: string) => void;
    getParameterInfo: (paramId: string) => DiscoveredInput | undefined;
  }

  let {
    tabs = $bindable(),
    activeTabId,
    onTabChange,
    onAddTab,
    onRemoveTab,
    onReorderTabs,
    onAddGroup,
    onRemoveGroup,
    onReorderGroups,
    onParameterDrop,
    onReorder,
    onRemoveItem,
    getParameterInfo,
  }: Props = $props();

  const activeTab = $derived(tabs.find((t) => t.id === activeTabId));

  // Drag state for group reordering
  let draggedGroupId: string | null = $state(null);
  let dragOverGroupId: string | null = $state(null);

  // Clear group drag state when items are being dragged
  $effect(() => {
    if (dragStore.current) {
      draggedGroupId = null;
      dragOverGroupId = null;
    }
  });

  function handleGroupDragStart(e: DragEvent, groupId: string) {
    // Prevent drag if initiated from an input element or any interactive element
    const target = e.target as HTMLElement;

    // Check if the target itself or any of its parents up to the draggable container is an input/button
    let element: HTMLElement | null = target;
    while (element && element !== e.currentTarget) {
      if (
        element.tagName === 'INPUT' ||
        element.tagName === 'TEXTAREA' ||
        element.tagName === 'BUTTON'
      ) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      element = element.parentElement;
    }

    draggedGroupId = groupId;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-group', groupId); // Use custom MIME type to distinguish from parameter drops
    }
  }

  function handleGroupDragOver(e: DragEvent, groupId: string) {
    // Only handle group drag over if we're actually dragging a group
    if (!draggedGroupId || draggedGroupId === groupId) return;

    // Check if we're dragging a group (not an item)
    // If dragStore has data, it means we're dragging an item, not a group
    if (dragStore.current) return;

    // Check if we're dragging a group via MIME type
    if (!e.dataTransfer?.types.includes('application/x-group')) return;

    e.preventDefault();
    dragOverGroupId = groupId;
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move';
    }
  }

  function handleGroupDragLeave(e: DragEvent, groupId: string) {
    // Only handle if we're actually highlighting this group
    if (dragOverGroupId !== groupId) return;

    // Only clear highlight if actually leaving the group wrapper (not child elements)
    const relatedTarget = e.relatedTarget as Node | null;
    const currentTarget = e.currentTarget as Node;
    if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
      dragOverGroupId = null;
    }
  }

  function handleGroupDrop(e: DragEvent, targetGroupId: string) {
    e.preventDefault();
    e.stopPropagation();

    if (!draggedGroupId || !activeTab) return;

    const fromIndex = activeTab.groups.findIndex((g) => g.id === draggedGroupId);
    const toIndex = activeTab.groups.findIndex((g) => g.id === targetGroupId);

    if (fromIndex !== -1 && toIndex !== -1 && fromIndex !== toIndex) {
      onReorderGroups(activeTab.id, fromIndex, toIndex);
    }

    // Always clear states after drop
    draggedGroupId = null;
    dragOverGroupId = null;
  }

  function handleGroupDragEnd() {
    // Always clear states when drag ends (whether dropped or cancelled)
    draggedGroupId = null;
    dragOverGroupId = null;
  }

  // Computed flag to check if we're actually dragging a group (not an item)
  const isDraggingGroup = $derived(!!draggedGroupId && !dragStore.current);
</script>

<Card.Root class="shadow-sm">
  <Card.Header class="flex flex-row items-center justify-between space-y-0">
    <div></div>
    <Button onclick={onAddTab}>+ Add Tab</Button>
  </Card.Header>
  <Card.Content>
    <div class="min-h-[200px]">
      {#if !tabs || tabs.length === 0}
        <StateDisplay
          type="empty"
          size="large"
          title="No tabs yet"
          message="Click 'Add Tab' to create your first tab"
        />
      {:else}
        <!-- Tab Navigation -->
        <EditableTabNav {tabs} {activeTabId} {onTabChange} {onRemoveTab} {onReorderTabs} />

        <!-- Active Tab Content -->
        {#if activeTab}
          <div class="animate-[fadeIn_0.2s]">
            <div class="mb-6 flex justify-end">
              <Button variant="outline" onclick={() => onAddGroup(activeTab.id)}>
                + Add Group
              </Button>
            </div>

            {#if activeTab.groups.length === 0}
              <StateDisplay
                type="empty"
                size="medium"
                message="No groups yet. Click 'Add Group' to organize your parameters."
              />
            {:else}
              <div class="flex flex-col gap-6">
                {#each activeTab.groups as group, groupIndex (group.id)}
                  <div
                    class="transition-opacity {draggedGroupId === group.id
                      ? 'opacity-50'
                      : ''} {dragOverGroupId === group.id ? 'border-t-4 border-t-primary' : ''}"
                    ondragover={(e) => handleGroupDragOver(e, group.id)}
                    ondragleave={(e) => handleGroupDragLeave(e, group.id)}
                    ondrop={(e) => handleGroupDrop(e, group.id)}
                    role="group"
                    tabindex="-1"
                  >
                    <EditableGroup
                      bind:group={activeTab.groups[groupIndex]}
                      onDrop={(e) => onParameterDrop(activeTab.id, group.id, e)}
                      {onReorder}
                      onRemove={() => onRemoveGroup(activeTab.id, group.id)}
                      onDragStart={(e) => handleGroupDragStart(e, group.id)}
                      onDragEnd={handleGroupDragEnd}
                      isDragging={draggedGroupId === group.id}
                    >
                      {#each group.items as item (item.id)}
                        {@const paramInfo = getParameterInfo(item.paramId)}
                        <BuilderGroupItem
                          {item}
                          {paramInfo}
                          tabId={activeTab.id}
                          groupId={group.id}
                          onRemove={() => onRemoveItem(activeTab.id, group.id, item.id)}
                        />
                      {/each}
                    </EditableGroup>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        {/if}
      {/if}
    </div>
  </Card.Content>
</Card.Root>
