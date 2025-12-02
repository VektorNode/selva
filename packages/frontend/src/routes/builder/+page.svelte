<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { PageContainer, PageHeader } from '$lib/components/layout';
  import { StateDisplay, Button } from '$lib/components/ui';
  import { DragDropContext, BuilderSidebar, TabEditor } from '$lib/components/builder';
  import type { AvailableInput, AvailableOutput } from '$lib/types/generated';
  import { initializeWebSocketSession } from '$lib/utils/session';
  import {
    handleItemDrop,
    handleGroupItemDrop,
    addTab,
    removeTab,
    addGroup,
    removeGroup,
    removeItem,
    reorderTabs,
  } from '$lib/features/builder/operations';
  import Save from '$lib/components/ui/icons/Save.svelte';
  import { toast } from '$lib/components/ui/sonner';
  import { onMount } from 'svelte';
  import { useBuilderState } from '$lib/composables/useBuilderState.svelte';

  let sessionId = $state('');
  let builderState = $state<ReturnType<typeof useBuilderState> | null>(null);

  // Navigate to specific routes with session preservation
  function navigateTo(route: '/' | '/preview') {
    // Auto-save schema when switching to interactive mode
    if (route === '/preview') {
      saveSchema();
    }

    const url = route === '/' ? `/?session=${sessionId}` : `/preview?session=${sessionId}`;
    goto(url);
  }

  const placedInLayoutIds = $derived(() => {
    const ids = new Set<string>();
    builderState?.state.schema?.layout?.tabs?.forEach((tab) => {
      tab.groups.forEach((group) => {
        group.items.forEach((item) => {
          ids.add(item.paramId);
        });
      });
    });
    return ids;
  });

  const availableInputs = $derived(
    builderState?.state.availableInputs.filter((p) => !placedInLayoutIds().has(p.id)) || []
  );

  const availableOutputsUnplaced = $derived(
    builderState?.state.availableOutputs.filter((o) => !placedInLayoutIds().has(o.id)) || []
  );

  function saveSchema() {
    if (!builderState?.state.schema || !sessionId) return;

    if (!builderState.wsState.connected) {
      toast.error('Not connected to Grasshopper');
      return;
    }

    builderState.wsState.saveSchema(sessionId, $state.snapshot(builderState.state.schema));
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveSchema();
    }
  }

  onMount(() => {
    const urlSessionId = page.url.searchParams.get('session') || '';
    sessionId = urlSessionId;

    const initializeBuilder = async () => {
      const result = await initializeWebSocketSession(urlSessionId);

      if (result.error) {
        if (builderState) {
          builderState.state.error = result.error;
          builderState.state.loading = false;
        }
        return;
      }

      builderState = useBuilderState(urlSessionId);
      builderState.initialize();
    };

    initializeBuilder();
    window.addEventListener('keydown', handleKeydown);

    return () => {
      window.removeEventListener('keydown', handleKeydown);
      builderState?.cleanup();
    };
  });

  function handleParameterDrop(tabId: string, groupId: string, event: CustomEvent) {
    if (!builderState?.state.schema) return;

    const { dropType, data, targetItem, dropPosition, sourceTabId, sourceGroupId, sourceItem } =
      event.detail;

    const tab = builderState.state.schema.layout.tabs?.find((t) => t.id === tabId);
    if (!tab) return;

    const group = tab.groups.find((g) => g.id === groupId);
    if (!group) return;

    // Handle moving items within layout
    if (dropType === 'group-item') {
      handleGroupItemDrop(
        builderState.state.schema,
        tabId,
        groupId,
        sourceTabId,
        sourceGroupId,
        sourceItem,
        targetItem,
        dropPosition
      );
      return;
    }

    // Handle dropping inputs or outputs
    if (dropType === 'input') {
      const param = data as AvailableInput;
      handleItemDrop(
        builderState.state.schema,
        group,
        param.id,
        param.nickname || param.name,
        'input',
        builderState.state.availableInputs,
        param.type,
        undefined,
        targetItem,
        dropPosition
      );
    } else if (dropType === 'output') {
      const output = data as AvailableOutput;
      const widgetType = output.type === 'file' ? 'file' : 'text';
      handleItemDrop(
        builderState.state.schema,
        group,
        output.id,
        output.nickname,
        'output',
        builderState.state.availableInputs,
        undefined,
        widgetType,
        targetItem,
        dropPosition,
        output.type
      );
    }
  }

  function handleReorder(event: CustomEvent) {
    if (!builderState?.state.schema) return;

    const {
      sourceItem,
      sourceTabId,
      sourceGroupId,
      targetItem,
      targetTabId,
      targetGroupId,
      dropPosition,
    } = event.detail;

    if (sourceItem.id === targetItem.id) return;

    const sourceTab = builderState.state.schema.layout.tabs?.find((t) => t.id === sourceTabId);
    const targetTab = builderState.state.schema.layout.tabs?.find((t) => t.id === targetTabId);
    if (!sourceTab || !targetTab) return;

    const sourceGroup = sourceTab.groups.find((g) => g.id === sourceGroupId);
    const targetGroup = targetTab.groups.find((g) => g.id === targetGroupId);
    if (!sourceGroup || !targetGroup) return;

    const sourceIndex = sourceGroup.items.findIndex((i) => i.id === sourceItem.id);
    if (sourceIndex < 0) return;

    const [movedItem] = sourceGroup.items.splice(sourceIndex, 1);

    let targetIndex = targetGroup.items.findIndex((i) => i.id === targetItem.id);

    if (targetIndex < 0) {
      targetGroup.items.push(movedItem);
    } else {
      if (sourceGroup === targetGroup && sourceIndex < targetIndex) {
        targetIndex--;
      }

      if (dropPosition === 'before') {
        targetGroup.items.splice(targetIndex, 0, movedItem);
      } else {
        targetGroup.items.splice(targetIndex + 1, 0, movedItem);
      }
    }
  }

  function getParameterInfo(paramId: string) {
    return builderState?.state.availableInputs.find((p) => p.id === paramId);
  }

  /**
   * Handle adding an item to an existing group via context menu
   */
  function handleAddToGroup(
    tabId: string,
    groupId: string,
    item: AvailableInput | AvailableOutput
  ) {
    if (!builderState?.state.schema) return;

    const tab = builderState.state.schema.layout.tabs?.find((t) => t.id === tabId);
    if (!tab) return;

    const group = tab.groups.find((g) => g.id === groupId);
    if (!group) return;

    const itemType = 'name' in item ? 'input' : 'output';
    const paramType = 'name' in item ? item.type : undefined;
    const widgetType = 'name' in item ? undefined : item.type === 'file' ? 'file' : 'text';
    const outputType = 'name' in item ? undefined : item.type;

    handleItemDrop(
      builderState.state.schema,
      group,
      item.id,
      item.nickname || ('name' in item ? item.name : 'Unknown'),
      itemType,
      builderState.state.availableInputs,
      paramType,
      widgetType,
      undefined,
      undefined,
      outputType
    );

    toast.success(`Added to ${tab.label} / ${group.label}`);
  }

  /**
   * Handle adding an item to a new group via context menu
   */
  function handleAddToNewGroup(path: string, item: AvailableInput | AvailableOutput) {
    if (!builderState?.state.schema) return;

    const schema = builderState.state.schema;
    const parts = path.split('/').map((p) => p.trim());
    let tabId: string;
    let groupLabel: string;

    if (parts.length === 2) {
      const [tabLabel, grpLabel] = parts;
      let tab = schema.layout.tabs?.find((t) => t.label.toLowerCase() === tabLabel.toLowerCase());

      if (!tab) {
        const newTabId = addTab(schema);
        tab = schema.layout.tabs?.find((t) => t.id === newTabId);
        if (tab) {
          tab.label = tabLabel;
          toast.success(`Created new tab: ${tabLabel}`);
        }
      }

      if (!tab) return;
      tabId = tab.id;
      groupLabel = grpLabel;
    } else {
      groupLabel = parts[0];
      if (builderState.state.activeTabId) {
        tabId = builderState.state.activeTabId;
      } else if (schema.layout.tabs && schema.layout.tabs.length > 0) {
        tabId = schema.layout.tabs[0].id;
      } else {
        // Create first tab
        const newTabId = addTab(schema);
        tabId = newTabId;
        builderState.state.activeTabId = newTabId;
      }
    }

    const tab = schema.layout.tabs?.find((t) => t.id === tabId);
    if (!tab) return;

    // Find or create group
    let group = tab.groups.find((g) => g.label.toLowerCase() === groupLabel.toLowerCase());
    if (!group) {
      addGroup(schema, tabId);
      group = tab.groups[tab.groups.length - 1];
      group.label = groupLabel;
      toast.success(`Created new group: ${groupLabel}`);
    }

    // Add item to group
    const itemType = 'name' in item ? 'input' : 'output';
    const paramType = 'name' in item ? item.type : undefined;
    const widgetType = 'name' in item ? undefined : item.type === 'file' ? 'file' : 'text';
    const outputType = 'name' in item ? undefined : item.type;

    handleItemDrop(
      schema,
      group,
      item.id,
      item.nickname || ('name' in item ? item.name : 'Unknown'),
      itemType,
      builderState.state.availableInputs,
      paramType,
      widgetType,
      undefined,
      undefined,
      outputType
    );

    toast.success(`Added ${item.nickname || 'item'} to ${tab.label} / ${group.label}`);
  }

  function handleTabChange(tabId: string) {
    if (builderState) {
      builderState.state.activeTabId = tabId;
    }
  }

  function handleAddTab() {
    if (!builderState?.state.schema) return;
    const newTabId = addTab(builderState.state.schema);
    builderState.state.activeTabId = newTabId;
  }

  function handleRemoveTab(tabId: string) {
    if (!builderState?.state.schema) return;
    removeTab(builderState.state.schema, tabId);

    if (
      builderState.state.activeTabId === tabId &&
      builderState.state.schema.layout.tabs &&
      builderState.state.schema.layout.tabs.length > 0
    ) {
      builderState.state.activeTabId = builderState.state.schema.layout.tabs[0].id;
    }
  }

  function handleReorderTabs(fromIndex: number, toIndex: number) {
    if (!builderState?.state.schema) return;
    reorderTabs(builderState.state.schema, fromIndex, toIndex);
  }

  function handleAddGroup(tabId: string) {
    if (!builderState?.state.schema) return;
    addGroup(builderState.state.schema, tabId);
  }

  function handleRemoveGroup(tabId: string, groupId: string) {
    if (!builderState?.state.schema) return;
    removeGroup(builderState.state.schema, tabId, groupId);
  }

  function handleRemoveItem(tabId: string, groupId: string, itemId: string) {
    if (!builderState?.state.schema) return;
    removeItem(builderState.state.schema, tabId, groupId, itemId);
  }
</script>

<DragDropContext>
  <PageContainer background="white">
    <PageHeader title="Schema Builder" {sessionId} showModeToggle={true}>
      <nav class="flex items-center gap-2">
        {#if builderState?.state.syncNeeded}
          <Button
            variant="default"
            size="sm"
            onclick={() => builderState?.syncParameters()}
            class="animate-pulse bg-amber-500 hover:bg-amber-600"
          >
            ⚡ Sync Parameters
          </Button>
        {/if}
        <Button variant="outline" size="sm" onclick={() => navigateTo('/')}>Home</Button>
        <Button variant="default" size="sm">Schema Builder</Button>
        <Button variant="outline" size="sm" onclick={() => navigateTo('/preview')}>
          Interactive Preview
        </Button>
      </nav>
    </PageHeader>

    <div class="flex-1 overflow-auto">
      {#if builderState?.state.loading}
        <div class="flex min-h-[400px] items-center justify-center">
          <StateDisplay type="loading" size="large" message="Loading schema..." />
        </div>
      {:else if builderState?.state.schema}
        <div
          class="mx-auto grid h-full max-w-[2000px] grid-cols-1 gap-6 p-6 xl:grid-cols-[400px_1fr]"
        >
          {#if builderState.state.error}
            <div class="col-span-2">
              <StateDisplay type="warning" size="medium" message={builderState.state.error} />
            </div>
          {/if}

          <BuilderSidebar
            schema={builderState.state.schema}
            {availableInputs}
            availableOutputs={availableOutputsUnplaced}
            placedIds={placedInLayoutIds()}
            syncNeeded={builderState.state.syncNeeded}
            onSchemaChange={(updatedSchema) => {
              if (builderState) builderState.state.schema = updatedSchema;
            }}
            onSync={() => builderState?.syncParameters()}
            onAddToGroup={handleAddToGroup}
            onAddToNewGroup={handleAddToNewGroup}
          />

          <main class="flex flex-col gap-6">
            {#if builderState.state.schema.layout?.tabs}
              <TabEditor
                bind:tabs={builderState.state.schema.layout.tabs}
                activeTabId={builderState.state.activeTabId}
                onTabChange={handleTabChange}
                onAddTab={handleAddTab}
                onRemoveTab={handleRemoveTab}
                onReorderTabs={handleReorderTabs}
                onAddGroup={handleAddGroup}
                onRemoveGroup={handleRemoveGroup}
                onParameterDrop={handleParameterDrop}
                onReorder={handleReorder}
                onRemoveItem={handleRemoveItem}
                {getParameterInfo}
              />
            {/if}

            <div class="mb-20 flex justify-end gap-4">
              <Button onclick={saveSchema}><Save></Save>Save Schema</Button>
            </div>
          </main>
        </div>
      {/if}
    </div>
  </PageContainer>
</DragDropContext>
