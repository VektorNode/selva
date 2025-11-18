<script lang="ts">
  import { page } from "$app/state";
  import { api } from "$lib/api/client";
  import { PageContainer, PageHeader, Panel } from "$lib/components/layout";
  import { StateDisplay, Button } from "$lib/components/ui";
  import {
    DragDropContext,
    ParameterList,
    SchemaInfoPanel,
    EditableTabNav,
    EditableGroup,
    BuilderGroupItem,
  } from "$lib/components/builder";
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
  } from "$lib/types/schema";
  import {
    mapParamTypeToWidgetType,
    createDefaultWidgetConfig,
  } from "$lib/utils/widget-config";
  import Save from "$lib/components/ui/icons/Save.svelte";

  let sessionId = $state("");
  let schema = $state<UISchema | null>(null);
  let availableParams = $state<AvailableParameter[]>([]);
  let loading = $state(true);
  let error = $state("");
  let activeTabId = $state<string | null>(null);

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
    availableParams.filter(
      (p) => p.category === "input" && !placedInLayoutIds().has(p.id)
    )
  );
  const availableOutputs = $derived(
    availableParams.filter(
      (p) => p.category === "output" && !placedInLayoutIds().has(p.id)
    )
  );
  const activeTab = $derived(
    schema?.layout?.tabs?.find((t) => t.id === activeTabId)
  );

  $effect(() => {
    (async () => {
      const urlSessionId = page.url.searchParams.get("session") || "";
      sessionId = urlSessionId;

      if (!urlSessionId) {
        error = "No session ID provided";
        loading = false;
        return;
      }

      const [schemaData, availableData] = await Promise.all([
        api.getSchema(urlSessionId),
        api.getAvailableParameters(urlSessionId),
      ]);

      availableParams = availableData?.parameters || [];

      if (!schemaData) {
        schema = {
          id: crypto.randomUUID(),
          name: "New Schema",
          description: "Configure your Grasshopper UI",
          version: "1.0.0",
          created: new Date().toISOString(),
          inputs: [],
          outputs: [],
          layout: {
            type: "tabbed",
            gap: 16,
            tabs: [],
            items: [],
          },
          enable3dViewer: false,
        };
      } else {
        schema = schemaData;
        if (!schema.layout) {
          schema.layout = {
            type: "tabbed",
            gap: 16,
            tabs: [],
            items: [],
          };
        }
        if (!schema.layout.tabs) {
          schema.layout.tabs = [];
        }
      }

      if (availableParams.length === 0) {
        error =
          "No parameters found. Please ensure the UI Builder component is active in Grasshopper and click Refresh.";
      }

      if (schema?.layout?.tabs && schema.layout.tabs.length > 0) {
        activeTabId = schema.layout.tabs[0].id;
      }

      loading = false;
    })();
  });

  async function saveSchema() {
    if (!schema || !sessionId) return;

    const success = await api.saveSchema(sessionId, schema);
    if (success) {
      alert("Schema saved successfully!");
    } else {
      alert("Failed to save schema");
    }
  }

  //TODO: Add possibility to reorder tabs

  /**
   * Helper function to remove a parameter from inputs/outputs if it's not used in the layout
   */
  function removeParameterIfOrphaned(
    paramId: string,
    itemType: "input" | "output"
  ) {
    if (!schema) return;

    const isUsedInLayout =
      schema.layout.tabs?.some((t) =>
        t.groups.some((g) => g.items.some((i) => i.paramId === paramId))
      ) ?? false;

    if (!isUsedInLayout) {
      if (itemType === "input") {
        schema.inputs = schema.inputs.filter((i) => i.id !== paramId);
      } else if (itemType === "output") {
        schema.outputs = schema.outputs.filter((o) => o.id !== paramId);
      }
    }
  }

  function addTab() {
    if (!schema || !schema.layout.tabs) return;

    const newTab: TabConfig = {
      id: crypto.randomUUID().substring(0, 8),
      label: `Tab ${schema.layout.tabs.length + 1}`,
      icon: "",
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
      description: "",
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

    // Don't remove parameters when deleting a group - they should just become available again
    // The parameters remain in schema.inputs/outputs so users can re-add them without losing config

    tab.groups = tab.groups.filter((g) => g.id !== groupId);
    schema.layout.tabs = [...schema.layout.tabs];
  }

  function handleParameterDrop(
    tabId: string,
    groupId: string,
    event: CustomEvent
  ) {
    if (!schema || !schema.layout.tabs) return;

    const { type, data, sourceType, targetItem, dropPosition } = event.detail;
    if (type !== "parameter") return;

    const param = data as AvailableParameter;
    const tab = schema.layout.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const group = tab.groups.find((g) => g.id === groupId);
    if (!group) return;

    const exists = group.items.some((i) => i.paramId === param.id);
    if (exists) {
      alert("This parameter is already in this group");
      return;
    }

    if (sourceType === "input") {
      const inputExists = schema.inputs.some((i) => i.id === param.id);
      if (!inputExists) {
        const newInput: InputParamSchema = {
          id: param.id,
          name: param.name,
          nickname: param.nickname,
          paramType: param.paramType,
          description: param.description,
          atLeast: param.atLeast ?? 1,
          atMost: param.atMost ?? 1,
          treeAccess: param.treeAccess ?? false,
          minimum: param.minimum,
          maximum: param.maximum,
          stepSize: param.stepSize,
        };
        schema.inputs = [...schema.inputs, newInput];
      }
    } else if (sourceType === "output") {
      const outputExists = schema.outputs.some((o) => o.id === param.id);
      if (!outputExists) {
        const newOutput: OutputParamSchema = {
          id: param.id,
          name: param.name,
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

    if (sourceType === "input") {
      newItem = {
        id: crypto.randomUUID().substring(0, 8),
        paramId: param.id,
        type: "input",
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
        type: "output",
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
        if (dropPosition === "before") {
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

    const sourceIndex = sourceGroup.items.findIndex(
      (i) => i.id === sourceItem.id
    );
    if (sourceIndex < 0) return;

    const [movedItem] = sourceGroup.items.splice(sourceIndex, 1);

    //TODO: When the group is empty, its not possible to move items into it from another group
    let targetIndex = targetGroup.items.findIndex(
      (i) => i.id === targetItem.id
    );

    if (targetIndex < 0) {
      targetGroup.items.push(movedItem);
    } else {
      if (sourceGroup === targetGroup && sourceIndex < targetIndex) {
        targetIndex--;
      }

      if (dropPosition === "before") {
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
  <PageContainer>
    <PageHeader title="Schema Builder" />

    <div class="flex-1 overflow-auto bg-gray-50">
      {#if loading}
        <div class="flex items-center justify-center min-h-[400px]">
          <StateDisplay
            type="loading"
            size="large"
            message="Loading schema..."
          />
        </div>
      {:else if schema}
        <div
          class="grid grid-cols-1 xl:grid-cols-[400px_1fr] gap-6 p-6 max-w-[2000px] mx-auto h-full"
        >
          {#if error}
            <div class="col-span-2">
              <StateDisplay type="warning" size="medium" message={error} />
            </div>
          {/if}

          <!-- Left Sidebar: Schema Info & Available Parameters -->
          <aside class="flex flex-col gap-6">
            <SchemaInfoPanel {schema} />

            <Panel title="Available Parameters">
              <p class="text-gray-600 text-sm mb-4">
                Drag parameters into groups below
              </p>

              <ParameterList
                title="Inputs"
                icon="mdi:input"
                parameters={availableInputs}
                category="input"
                emptyMessage="No contextual parameters found."
              />

              <ParameterList
                title="Outputs"
                icon="mdi:output"
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
                <Button variant="primary" onclick={addTab}>+ Add Tab</Button>
              {/snippet}

              <div class="min-h-[200px]">
                {#if !schema.layout.tabs || schema.layout.tabs.length === 0}
                  <StateDisplay
                    type="empty"
                    size="large"
                    icon="material-symbols:ballot"
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
                  />

                  <!-- Active Tab Content -->
                  {#if activeTab}
                    <div class="animate-[fadeIn_0.2s]">
                      <div class="mb-6 flex justify-end">
                        <Button
                          variant="secondary"
                          onclick={() => addGroup(activeTab.id)}
                        >
                          + Add Group
                        </Button>
                      </div>

                      {#if activeTab.groups.length === 0}
                        <StateDisplay
                          type="empty"
                          size="medium"
                          icon="📦"
                          message="No groups yet. Click 'Add Group' to organize your parameters."
                        />
                      {:else}
                        <div class="flex flex-col gap-6">
                          {#each activeTab.groups as group (group.id)}
                            <EditableGroup
                              {group}
                              onDrop={(e) =>
                                handleParameterDrop(activeTab.id, group.id, e)}
                              onReorder={handleReorder}
                              onRemove={() =>
                                removeGroup(activeTab.id, group.id)}
                            >
                              {#each group.items as item (item.id)}
                                {@const paramInfo = getParameterInfo(
                                  item.paramId
                                )}
                                <BuilderGroupItem
                                  {item}
                                  {paramInfo}
                                  tabId={activeTab.id}
                                  groupId={group.id}
                                  onRemove={() =>
                                    removeItem(activeTab.id, group.id, item.id)}
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

            <div class="flex justify-end gap-4">
              <Button variant="success" onclick={saveSchema}
                ><Save></Save>Save Schema</Button
              >
            </div>
          </main>
        </div>
      {/if}
    </div>
  </PageContainer>
</DragDropContext>
