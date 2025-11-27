<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { getWebSocketState } from '$lib/websocket/websocket.svelte';
  import { PageContainer, PageHeader, Panel } from '$lib/components/layout';
  import { StateDisplay, Button } from '$lib/components/ui';
  import {
    DragDropContext,
    InputItemList,
    OutputItemList,
    DownloadItemList,
    SchemaInfoPanel,
    EditableTabNav,
    EditableGroup,
    BuilderGroupItem,
  } from '$lib/components/builder';
  import type {
    UISchema,
    AvailableParameter,
    InputParamSchema,
    OutputParamSchema,
    TabConfig,
    GroupConfig,
    LayoutItem,
    InputLayoutItem,
    OutputLayoutItem,
  } from '$lib/types/generated';
  import { mapParamTypeToWidgetType, createDefaultWidgetConfig } from '$lib/utils/widget-config';
  import { initializeWebSocketSession, processInitialDataSchema } from '$lib/utils/session';
  import Save from '$lib/components/ui/icons/Save.svelte';
  import { toast } from '$lib/components/ui/sonner';
  import { onMount } from 'svelte';

  // Get WebSocket state singleton - reactive properties update automatically
  const wsState = getWebSocketState();

  let sessionId = $state('');
  let schema = $state<UISchema | null>(null);
  let availableParams = $state<AvailableParameter[]>([]);
  let loading = $state(true);
  let error = $state('');
  let activeTabId = $state<string | null>(null);
  let syncNeeded = $state(false);

  // Navigate to specific routes with session preservation
  function navigateTo(route: '/' | '/preview') {
    const url = route === '/' ? `/?session=${sessionId}` : `/preview?session=${sessionId}`;
    goto(url);
  }

  const placedInLayoutIds = $derived(() => {
    const ids = new Set<string>();
    schema?.layout?.tabs?.forEach((tab) => {
      tab.groups.forEach((group) => {
        group.items.forEach((item) => {
          ids.add(item.paramId);
        });
      });
    });
    return ids;
  });

  const availableInputs = $derived(
    availableParams.filter((p) => p.category === 'input' && !placedInLayoutIds().has(p.id))
  );
  const availableOutputs = $derived(
    availableParams.filter((p) => p.category === 'output' && !placedInLayoutIds().has(p.id))
  );
  const activeTab = $derived(schema?.layout?.tabs?.find((t) => t.id === activeTabId));

  function syncParameters() {
    console.log('[Builder] Syncing parameters from Grasshopper');
    syncNeeded = false;
    wsState.requestInitialData(sessionId);
    toast.info('Syncing parameters...');
  }

  function saveSchema() {
    if (!schema || !sessionId) return;

    if (!wsState.connected) {
      toast.error('Not connected to Grasshopper');
      return;
    }

    wsState.saveSchema(sessionId, $state.snapshot(schema));
  }

  onMount(() => {
    const handleInitialData = (message: any) => {
      if (message.sessionId === sessionId) {
        const result = processInitialDataSchema(message, true);

        availableParams = result.availableParams;

        schema = result.schema;

        if (availableParams.length === 0) {
          error =
            'No parameters found. Please ensure the UI Builder component is active in Grasshopper and click Refresh.';
        }

        if (schema?.layout?.tabs && schema.layout.tabs.length > 0) {
          activeTabId = schema.layout.tabs[0].id;
        }

        loading = false;
      }
    };

    const handleSchemaSaved = (message: any) => {
      if (message.sessionId === sessionId) {
        if (message.success) {
          toast.success('Schema saved successfully!');
        } else {
          toast.error(`Failed to save schema: ${message.message || 'Unknown error'}`);
        }
      }
    };

    const handleMetadataUpdated = (message: any) => {
      if (message.sessionId === sessionId && schema) {
        console.log('[Builder] Parameter metadata updated:', message.changedParams);

        const changedParams = message.changedParams || [];
        if (changedParams.length === 0) return;

        let updateCount = 0;
        const updatedNames: string[] = [];

        // Update input parameters with new metadata
        changedParams.forEach((updated: any) => {
          const inputIndex = schema!.inputs.findIndex((inp) => inp.id === updated.id);
          if (inputIndex !== -1) {
            const input = schema!.inputs[inputIndex];
            let changed = false;

            if (updated.nickname !== undefined && input.nickname !== updated.nickname) {
              input.nickname = updated.nickname;
              updatedNames.push(input.nickname);
              updateCount++;
              changed = true;
              console.log(`[Builder] Updated input: ${input.nickname}`);
            }
            if (updated.description !== undefined && input.description !== updated.description) {
              input.description = updated.description;
              changed = true;
            }

            // Update available params list to reflect changes
            const availIndex = availableParams.findIndex((p) => p.id === updated.id);
            if (availIndex !== -1) {
              if (updated.nickname !== undefined)
                availableParams[availIndex].nickname = updated.nickname;
              if (updated.description !== undefined)
                availableParams[availIndex].description = updated.description;
              if (updated.minimum !== undefined)
                availableParams[availIndex].minimum = updated.minimum;
              if (updated.maximum !== undefined)
                availableParams[availIndex].maximum = updated.maximum;
              if (updated.stepSize !== undefined)
                availableParams[availIndex].stepSize = updated.stepSize;
            }
          }

          // Update output parameters with new metadata
          const outputIndex = schema!.outputs.findIndex((out) => out.id === updated.id);
          if (outputIndex !== -1) {
            const output = schema!.outputs[outputIndex];
            let changed = false;

            if (updated.nickname !== undefined && output.nickname !== updated.nickname) {
              output.nickname = updated.nickname;
              updatedNames.push(output.nickname);
              updateCount++;
              changed = true;
              console.log(`[Builder] Updated output: ${output.nickname}`);
            }
            if (updated.description !== undefined && output.description !== updated.description) {
              output.description = updated.description;
              changed = true;
            }

            // Update available params list to reflect changes
            const availIndex = availableParams.findIndex((p) => p.id === updated.id);
            if (availIndex !== -1) {
              if (updated.nickname !== undefined)
                availableParams[availIndex].nickname = updated.nickname;
              if (updated.description !== undefined)
                availableParams[availIndex].description = updated.description;
            }
          }
        });

        // Trigger reactivity by reassigning schema and availableParams
        if (updateCount > 0) {
          schema = schema;
          availableParams = availableParams;
          toast.success(
            `Parameter${updateCount > 1 ? 's' : ''} updated: ${updatedNames.join(', ')}`
          );

          // Auto-save schema to persist changes back to Grasshopper
          if (wsState.connected) {
            console.log('[Builder] Auto-saving schema after metadata update');
            wsState.saveSchema(sessionId, $state.snapshot(schema));
          }
        }
      }
    };

    const handleSchemaUpdated = (message: any) => {
      if (message.sessionId === sessionId) {
        console.log('[Builder] Schema structure changed:', {
          schema: message.schema,
          removedIds: message.removedIds,
        });

        const removedCount = message.removedIds?.length || 0;

        if (removedCount > 0) {
          // Parameters were removed - refresh available parameters and auto-save
          const newAvailableParams = availableParams.filter(
            (p) => !message.removedIds.includes(p.id)
          );
          availableParams = newAvailableParams;

          // Remove from schema and auto-save
          if (schema) {
            schema.inputs = schema.inputs.filter((i) => !message.removedIds.includes(i.id));
            schema.outputs = schema.outputs.filter((o) => !message.removedIds.includes(o.id));

            if (wsState.connected) {
              console.log('[Builder] Auto-saving schema after parameter removal');
              wsState.saveSchema(sessionId, $state.snapshot(schema));
            }
          }

          toast.info(
            `Parameter${removedCount > 1 ? 's' : ''} removed from Grasshopper: ${removedCount} item(s)`
          );
        } else {
          // New parameters may have been added - request fresh data
          wsState.requestInitialData(sessionId);
          toast.info('Schema structure updated - checking for new parameters...');
        }
      }
    };

    const handleParametersAdded = (message: any) => {
      if (message.sessionId === sessionId) {
        console.log('[Builder] New parameters added to Grasshopper:', message.availableParams);

        if (message.availableParams && Array.isArray(message.availableParams)) {
          // Update available parameters directly
          availableParams = message.availableParams;
          // Mark that sync is needed to pick up the new parameters in schema
          syncNeeded = true;
          toast.info('New parameters detected - click Sync to add them to your schema');
        } else {
          // Fallback: request fresh data
          wsState.requestInitialData(sessionId);
          toast.info('New parameters detected - refreshing...');
        }
      }
    };

    const handleKeydown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        saveSchema();
      }
    };

    const initializeBuilder = async () => {
      const urlSessionId = page.url.searchParams.get('session') || '';
      sessionId = urlSessionId;

      const result = await initializeWebSocketSession(urlSessionId);

      if (result.error) {
        error = result.error;
        loading = false;
        return;
      }

      wsState.on('initialData', handleInitialData);
      wsState.on('schemaSaved', handleSchemaSaved);
      wsState.on('metadataUpdated', handleMetadataUpdated);
      wsState.on('schemaUpdated', handleSchemaUpdated);
      wsState.on('parametersAdded', handleParametersAdded);

      wsState.requestInitialData(sessionId);
    };

    initializeBuilder();
    window.addEventListener('keydown', handleKeydown);

    return () => {
      window.removeEventListener('keydown', handleKeydown);
      wsState.off('initialData', handleInitialData);
      wsState.off('schemaSaved', handleSchemaSaved);
      wsState.off('metadataUpdated', handleMetadataUpdated);
      wsState.off('schemaUpdated', handleSchemaUpdated);
      wsState.off('parametersAdded', handleParametersAdded);
      // Don't disconnect - keep connection alive for page switching
    };
  });

  function reorderTabs(fromIndex: number, toIndex: number) {
    if (!schema || !schema.layout.tabs) return;

    const tabs = [...schema.layout.tabs];
    const [movedTab] = tabs.splice(fromIndex, 1);
    tabs.splice(toIndex, 0, movedTab);

    // Update order property for each tab
    tabs.forEach((tab, index) => {
      tab.order = index;
    });

    schema.layout.tabs = tabs;
  }

  /**
   * Check if an item is used anywhere in the layout
   */
  function isItemUsedInLayout(paramId: string): boolean {
    return (
      schema?.layout?.tabs?.some((t) =>
        t.groups.some((g) => g.items.some((i) => i.paramId === paramId))
      ) ?? false
    );
  }

  /**
   * Remove an item from the schema if it's not used anywhere in the layout
   * Handles inputs and outputs - downloadables are never removed
   */
  function removeItemIfOrphaned(paramId: string, itemType: 'input' | 'output') {
    if (!schema) return;

    // Never remove downloadables - they should always be available
    const isDownloadable = schema.downloading?.components?.some((c) => c.id === paramId);
    if (isDownloadable) return;

    const isUsed = isItemUsedInLayout(paramId);

    if (!isUsed) {
      if (itemType === 'input') {
        schema.inputs = schema.inputs.filter((i) => i.id !== paramId);
      } else if (itemType === 'output') {
        schema.outputs = schema.outputs.filter((o) => o.id !== paramId);
      }
    }
  }

  function addTab() {
    if (!schema || !schema.layout.tabs) return;

    const newTab: TabConfig = {
      id: crypto.randomUUID().substring(0, 8),
      label: `Tab ${schema.layout.tabs.length + 1}`,
      icon: '',
      order: schema.layout.tabs.length,
      groups: [],
    };

    schema.layout.tabs = [...schema.layout.tabs, newTab];
    activeTabId = newTab.id;
  }

  function removeTab(tabId: string) {
    if (!schema || !schema.layout.tabs) return;

    const tab = schema.layout.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    tab.groups.forEach((group) => {
      group.items.forEach((item) => {
        removeItemIfOrphaned(item.paramId, item.type);
      });
    });

    schema.layout.tabs = schema.layout.tabs.filter((t) => t.id !== tabId);

    if (activeTabId === tabId && schema.layout.tabs.length > 0) {
      activeTabId = schema.layout.tabs[0].id;
    }
  }

  function addGroup(tabId: string) {
    if (!schema || !schema.layout.tabs) return;

    const tab = schema.layout.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const newGroup: GroupConfig = {
      id: crypto.randomUUID().substring(0, 8),
      label: `Group ${tab.groups.length + 1}`,
      description: '',
      order: tab.groups.length,
      collapsed: false,
      columns: 1,
      items: [],
    };

    tab.groups = [...tab.groups, newGroup];
  }

  function removeGroup(tabId: string, groupId: string) {
    if (!schema || !schema.layout.tabs) return;

    const tab = schema.layout.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const group = tab.groups.find((g) => g.id === groupId);
    if (!group) return;

    tab.groups = tab.groups.filter((g) => g.id !== groupId);
    schema.layout.tabs = [...schema.layout.tabs];
  }

  /**
   * Insert an item at the specified position in a group, or append if no position
   */
  function insertLayoutItem(
    group: GroupConfig,
    item: LayoutItem,
    targetItem?: LayoutItem,
    dropPosition?: 'before' | 'after'
  ) {
    if (!targetItem || !dropPosition) {
      group.items = [...group.items, item];
      return;
    }

    const targetIndex = group.items.findIndex((i) => i.id === targetItem.id);
    if (targetIndex < 0) {
      group.items = [...group.items, item];
      return;
    }

    // Create new array to maintain reactivity
    const newItems = [...group.items];
    if (dropPosition === 'before') {
      newItems.splice(targetIndex, 0, item);
    } else {
      newItems.splice(targetIndex + 1, 0, item);
    }
    group.items = newItems;
  }

  /**
   * Handle reordering items between groups
   */
  function handleGroupItemDrop(
    tabId: string,
    groupId: string,
    sourceTabId: string,
    sourceGroupId: string,
    sourceItem: LayoutItem,
    targetItem?: LayoutItem,
    dropPosition?: 'before' | 'after'
  ) {
    if (!schema?.layout.tabs) return;

    const sourceTab = schema.layout.tabs.find((t) => t.id === sourceTabId);
    const targetTab = schema.layout.tabs.find((t) => t.id === tabId);
    if (!sourceTab || !targetTab) return;

    const sourceGroup = sourceTab.groups.find((g) => g.id === sourceGroupId);
    const targetGroup = targetTab.groups.find((g) => g.id === groupId);
    if (!sourceGroup || !targetGroup) return;

    const sourceIndex = sourceGroup.items.findIndex((i) => i.id === sourceItem.id);
    if (sourceIndex < 0) return;

    const [movedItem] = sourceGroup.items.splice(sourceIndex, 1);
    insertLayoutItem(targetGroup, movedItem, targetItem, dropPosition);
  }

  /**
   * Create a layout item for either a parameter or downloadable component
   */
  function createLayoutItem(
    paramId: string,
    displayName: string,
    itemType: 'input' | 'output',
    itemCount: number,
    widgetType?: string,
    paramType?: string
  ): LayoutItem {
    // Determine widget type
    let resolvedWidgetType = widgetType;
    if (!resolvedWidgetType) {
      if (itemType === 'input' && paramType) {
        resolvedWidgetType = mapParamTypeToWidgetType(paramType as any, 'input');
      } else if (itemType === 'output' && paramType) {
        resolvedWidgetType = mapParamTypeToWidgetType(paramType as any, 'output');
      } else {
        resolvedWidgetType = itemType === 'input' ? 'number' : 'text';
      }
    }

    // Get config if needed
    const config =
      itemType === 'input' && paramType
        ? createDefaultWidgetConfig(resolvedWidgetType as any, { paramType } as any, 'input')
        : itemType === 'output' && paramType
          ? createDefaultWidgetConfig(resolvedWidgetType as any, { paramType } as any, 'output')
          : {};

    return itemType === 'input'
      ? ({
          id: crypto.randomUUID().substring(0, 8),
          paramId,
          type: 'input',
          displayName,
          widgetType: resolvedWidgetType as any,
          order: itemCount,
          span: 1,
          config,
        } as InputLayoutItem)
      : ({
          id: crypto.randomUUID().substring(0, 8),
          paramId,
          type: 'output',
          displayName,
          widgetType: resolvedWidgetType as any,
          order: itemCount,
          span: 1,
          config: itemType === 'output' && resolvedWidgetType === 'file' ? {} : config,
        } as OutputLayoutItem);
  }

  /**
   * Unified handler for dropping parameters and downloadables
   */
  function handleItemDrop(
    group: GroupConfig,
    paramId: string,
    displayName: string,
    itemType: 'input' | 'output',
    paramType?: string,
    widgetType?: string,
    targetItem?: LayoutItem,
    dropPosition?: 'before' | 'after'
  ) {
    if (!schema) return;

    // Check if already in this group
    if (group.items.some((i) => i.paramId === paramId)) {
      const itemTypeLabel =
        widgetType === 'file' ? 'file component' : itemType === 'input' ? 'parameter' : 'output';
      toast.warning(`This ${itemTypeLabel} is already in this group`);
      return;
    }

    // Ensure it's in schema (skip for downloadables, they're managed separately)
    if (widgetType !== 'file') {
      if (itemType === 'input') {
        const inputExists = schema.inputs.some((i) => i.id === paramId);
        if (!inputExists) {
          schema.inputs = [
            ...schema.inputs,
            {
              id: paramId,
              nickname: displayName,
              paramType: (paramType as any) || 'Generic',
              description: '',
            } as InputParamSchema,
          ];
        }
      } else {
        const outputExists = schema.outputs.some((o) => o.id === paramId);
        if (!outputExists) {
          schema.outputs = [
            ...schema.outputs,
            {
              id: paramId,
              nickname: displayName,
              paramType: (paramType as any) || 'Generic',
              description: '',
            } as OutputParamSchema,
          ];
        }
      }
    }

    const newItem = createLayoutItem(
      paramId,
      displayName,
      itemType,
      group.items.length,
      widgetType,
      paramType
    );
    insertLayoutItem(group, newItem, targetItem, dropPosition);
  }

  function handleParameterDrop(tabId: string, groupId: string, event: CustomEvent) {
    if (!schema || !schema.layout.tabs) return;

    console.log('[Builder] Handling parameter/downloadable drop:', event.detail);

    const {
      dropType,
      data,
      paramCategory,
      targetItem,
      dropPosition,
      sourceTabId,
      sourceGroupId,
      sourceItem,
    } = event.detail;

    const tab = schema.layout.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const group = tab.groups.find((g) => g.id === groupId);
    if (!group) return;

    // Handle moving items within layout
    if (dropType === 'group-item') {
      handleGroupItemDrop(
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

    // Handle dropping parameters or downloadables
    if (dropType === 'parameter') {
      const param = data as AvailableParameter;
      handleItemDrop(
        group,
        param.id,
        param.nickname || param.name,
        paramCategory as 'input' | 'output',
        param.paramType,
        undefined,
        targetItem,
        dropPosition
      );
    } else if (dropType === 'downloadable') {
      const component = data;
      handleItemDrop(
        group,
        component.id,
        component.nickname,
        'output',
        undefined,
        'file',
        targetItem,
        dropPosition
      );
    }
  }

  function removeItem(tabId: string, groupId: string, itemId: string) {
    if (!schema || !schema.layout.tabs) return;

    const tab = schema.layout.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const group = tab.groups.find((g) => g.id === groupId);
    if (!group) return;

    const item = group.items.find((i) => i.id === itemId);
    group.items = group.items.filter((i) => i.id !== itemId);

    if (item) {
      removeItemIfOrphaned(item.paramId, item.type);
    }
  }

  function handleReorder(event: CustomEvent) {
    if (!schema || !schema.layout.tabs) return;

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

    const sourceTab = schema.layout.tabs.find((t) => t.id === sourceTabId);
    const targetTab = schema.layout.tabs.find((t) => t.id === targetTabId);
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
    return availableParams.find((p) => p.id === paramId);
  }
</script>

<DragDropContext>
  <PageContainer background="white">
    <PageHeader title="Schema Builder" {sessionId} showModeToggle={true}>
      <nav class="flex items-center gap-2">
        {#if syncNeeded}
          <Button
            variant="default"
            size="sm"
            onclick={syncParameters}
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
      {#if loading}
        <div class="flex min-h-[400px] items-center justify-center">
          <StateDisplay type="loading" size="large" message="Loading schema..." />
        </div>
      {:else if schema}
        <div
          class="mx-auto grid h-full max-w-[2000px] grid-cols-1 gap-6 p-6 xl:grid-cols-[400px_1fr]"
        >
          {#if error}
            <div class="col-span-2">
              <StateDisplay type="warning" size="medium" message={error} />
            </div>
          {/if}

          <!-- Left Sidebar: Schema Info & Available Parameters -->
          <aside class="flex flex-col gap-6">
            <SchemaInfoPanel
              {schema}
              onSchemaChange={(updatedSchema) => (schema = updatedSchema)}
            />

            <Panel title="Available Parameters">
              {#snippet headerActions()}
                {#if syncNeeded}
                  <Button
                    variant="default"
                    size="sm"
                    onclick={syncParameters}
                    class="bg-amber-500 hover:bg-amber-600"
                  >
                    Sync
                  </Button>
                {/if}
              {/snippet}
              <p class="mb-4 text-sm text-accent-foreground/40">
                Drag parameters into groups below
              </p>

              <InputItemList
                inputs={availableInputs}
                placedIds={placedInLayoutIds()}
                emptyMessage="No contextual parameters found."
              />

              <OutputItemList
                outputs={availableOutputs}
                placedIds={placedInLayoutIds()}
                emptyMessage="No output components found."
              />

              {#if schema.downloading?.components && schema.downloading.components.length > 0}
                <DownloadItemList
                  components={schema.downloading.components}
                  placedIds={placedInLayoutIds()}
                  emptyMessage="All downloadable components are already placed in the layout."
                />
              {/if}
            </Panel>
          </aside>

          <!-- Main Area: Tab & Group Builder -->
          <main class="flex flex-col gap-6">
            <Panel>
              {#snippet headerActions()}
                <Button onclick={addTab}>+ Add Tab</Button>
              {/snippet}

              <div class="min-h-[200px]">
                {#if !schema.layout.tabs || schema.layout.tabs.length === 0}
                  <StateDisplay
                    type="empty"
                    size="large"
                    title="No tabs yet"
                    message="Click 'Add Tab' to create your first tab"
                  />
                {:else}
                  <!-- Tab Navigation -->
                  <EditableTabNav
                    tabs={schema.layout.tabs}
                    {activeTabId}
                    onTabChange={(tabId) => (activeTabId = tabId)}
                    onRemoveTab={removeTab}
                    onReorderTabs={reorderTabs}
                  />

                  <!-- Active Tab Content -->
                  {#if activeTab}
                    <div class="animate-[fadeIn_0.2s]">
                      <div class="mb-6 flex justify-end">
                        <Button variant="outline" onclick={() => addGroup(activeTab.id)}>
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
                            <EditableGroup
                              bind:group={activeTab.groups[groupIndex]}
                              onDrop={(e) => handleParameterDrop(activeTab.id, group.id, e)}
                              onReorder={handleReorder}
                              onRemove={() => removeGroup(activeTab.id, group.id)}
                            >
                              {#each group.items as item (item.id)}
                                {@const paramInfo = getParameterInfo(item.paramId)}
                                <BuilderGroupItem
                                  {item}
                                  {paramInfo}
                                  tabId={activeTab.id}
                                  groupId={group.id}
                                  onRemove={() => removeItem(activeTab.id, group.id, item.id)}
                                />
                              {/each}
                            </EditableGroup>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/if}
                {/if}
              </div>
            </Panel>

            <div class="mb-20 flex justify-end gap-4">
              <Button onclick={saveSchema}><Save></Save>Save Schema</Button>
            </div>
          </main>
        </div>
      {/if}
    </div>
  </PageContainer>
</DragDropContext>
