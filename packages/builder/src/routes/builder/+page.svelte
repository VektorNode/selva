<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { getWebSocketState } from '$lib/websocket/websocket.svelte';
  import { PageContainer, PageHeader, Panel } from '$lib/components/layout';
  import { StateDisplay, Button } from '$lib/components/ui';
  import {
    DragDropContext,
    ParameterList,
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

      wsState.requestInitialData(sessionId);
    };

    initializeBuilder();
    window.addEventListener('keydown', handleKeydown);

    return () => {
      window.removeEventListener('keydown', handleKeydown);
      wsState.off('initialData', handleInitialData);
      wsState.off('schemaSaved', handleSchemaSaved);
      // Don't disconnect - keep connection alive for page switching
    };
  });

  function saveSchema() {
    if (!schema || !sessionId) return;

    if (!wsState.connected) {
      toast.error('Not connected to Grasshopper');
      return;
    }

    wsState.saveSchema(sessionId, $state.snapshot(schema));
  }

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
   * Helper function to remove a parameter from inputs/outputs if it's not used in the layout
   */
  function removeParameterIfOrphaned(paramId: string, itemType: 'input' | 'output') {
    if (!schema) return;

    const isUsedInLayout =
      schema.layout.tabs?.some((t) =>
        t.groups.some((g) => g.items.some((i) => i.paramId === paramId))
      ) ?? false;

    if (!isUsedInLayout) {
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
        removeParameterIfOrphaned(item.paramId, item.type);
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

  function handleParameterDrop(tabId: string, groupId: string, event: CustomEvent) {
    if (!schema || !schema.layout.tabs) return;

    const {
      type,
      data,
      sourceType,
      targetItem,
      dropPosition,
      sourceTabId,
      sourceGroupId,
      sourceItem,
    } = event.detail;

    // Handle moving items from another group
    if (type === 'group-item') {
      const sourceTab = schema.layout.tabs.find((t) => t.id === sourceTabId);
      const targetTab = schema.layout.tabs.find((t) => t.id === tabId);
      if (!sourceTab || !targetTab) return;

      const sourceGroup = sourceTab.groups.find((g) => g.id === sourceGroupId);
      const targetGroup = targetTab.groups.find((g) => g.id === groupId);
      if (!sourceGroup || !targetGroup) return;

      const sourceIndex = sourceGroup.items.findIndex((i) => i.id === sourceItem.id);
      if (sourceIndex < 0) return;

      const [movedItem] = sourceGroup.items.splice(sourceIndex, 1);

      targetGroup.items = [...targetGroup.items, movedItem];
      return;
    }

    if (type !== 'parameter') return;

    const param = data as AvailableParameter;
    const tab = schema.layout.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const group = tab.groups.find((g) => g.id === groupId);
    if (!group) return;

    const exists = group.items.some((i) => i.paramId === param.id);
    if (exists) {
      toast.warning('This parameter is already in this group');
      return;
    }

    if (sourceType === 'input') {
      const inputExists = schema.inputs.some((i) => i.id === param.id);
      if (!inputExists) {
        const newInput: InputParamSchema = {
          id: param.id,
          nickname: param.nickname,
          paramType: param.paramType,
          description: param.description,
        };
        schema.inputs = [...schema.inputs, newInput];
      }
    } else if (sourceType === 'output') {
      const outputExists = schema.outputs.some((o) => o.id === param.id);
      if (!outputExists) {
        const newOutput: OutputParamSchema = {
          id: param.id,
          nickname: param.nickname,
          paramType: param.paramType,
          description: param.description,
        };
        schema.outputs = [...schema.outputs, newOutput];
      }
    }

    const widgetType = mapParamTypeToWidgetType(param.paramType, sourceType);
    const config = createDefaultWidgetConfig(widgetType, param, sourceType);

    let newItem: LayoutItem;

    if (sourceType === 'input') {
      newItem = {
        id: crypto.randomUUID().substring(0, 8),
        paramId: param.id,
        type: 'input',
        displayName: param.nickname || param.name,
        widgetType: widgetType as any,
        order: group.items.length,
        span: 1,
        config: config,
      } as InputLayoutItem;
    } else {
      newItem = {
        id: crypto.randomUUID().substring(0, 8),
        paramId: param.id,
        type: 'output',
        displayName: param.nickname || param.name,
        widgetType: widgetType as any,
        order: group.items.length,
        span: 1,
        config: config,
      } as OutputLayoutItem;
    }

    if (targetItem && dropPosition) {
      const targetIndex = group.items.findIndex((i) => i.id === targetItem.id);
      if (targetIndex >= 0) {
        if (dropPosition === 'before') {
          group.items.splice(targetIndex, 0, newItem);
        } else {
          group.items.splice(targetIndex + 1, 0, newItem);
        }
        group.items = [...group.items];
      } else {
        group.items = [...group.items, newItem];
      }
    } else {
      group.items = [...group.items, newItem];
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
      removeParameterIfOrphaned(item.paramId, item.type);
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
      <nav class="flex gap-2">
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
              <p class="mb-4 text-sm text-accent-foreground/40">
                Drag parameters into groups below
              </p>

              <ParameterList
                title="Inputs"
                parameters={availableInputs}
                category="input"
                emptyMessage="No contextual parameters found."
              />

              <ParameterList
                title="Outputs"
                parameters={availableOutputs}
                category="output"
                emptyMessage="No context output components found."
              />
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
