<script lang="ts">
  import { page } from "$app/stores";
  import { api } from "$lib/api/client";
  import DragDropContext from "$lib/components/DragDropContext.svelte";
  import {
    PageContainer,
    PageHeader,
    StateDisplay,
    Button,
    Panel,
    ParameterList,
    SchemaInfoPanel,
    EditableTabNav,
    EditableGroup,
    BuilderGroupItem,
  } from "$lib/components/shared";
  import type {
    UISchema,
    AvailableParameter,
    InputParameter,
    OutputParameter,
    TabConfig,
    GroupConfig,
    GroupItem,
  } from "$lib/types/schema";

  // Reactive state using Svelte 5 runes
  let sessionId = $state("");
  let schema = $state<UISchema | null>(null);
  let availableParams = $state<AvailableParameter[]>([]);
  let loading = $state(true);
  let error = $state("");
  let activeTabId = $state<string | null>(null);

  // Derived state - computed values that update automatically
  const usedInputIds = $derived(
    new Set(schema?.inputs.map((i) => i.grasshopperId) || [])
  );
  const usedOutputIds = $derived(
    new Set(schema?.outputs.map((o) => o.grasshopperId) || [])
  );

  const availableInputs = $derived(
    availableParams.filter(
      (p) => p.category === "input" && !usedInputIds.has(p.id)
    )
  );
  const availableOutputs = $derived(
    availableParams.filter(
      (p) => p.category === "output" && !usedOutputIds.has(p.id)
    )
  );
  const activeTab = $derived(
    schema?.layout?.tabs?.find((t) => t.id === activeTabId)
  );

  // Load initial data - using untrack to avoid reactivity issues
  $effect(() => {
    (async () => {
      const urlSessionId = $page.url.searchParams.get("session") || "";
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
            columns: 2,
            gap: 16,
            tabs: [],
            items: [],
          },
          enable3dViewer: false,
        };
      } else {
        schema = schemaData;
        // Ensure layout exists
        if (!schema.layout) {
          schema.layout = {
            type: "tabbed",
            columns: 2,
            gap: 16,
            tabs: [],
            items: [],
          };
        }
        // Ensure layout has tabs array
        if (!schema.layout.tabs) {
          schema.layout.tabs = [];
        }

        var expiredParams = getExpiredParams();
      }

      if (availableParams.length === 0) {
        error =
          "No parameters found. Please ensure the UI Builder component is active in Grasshopper and click Refresh.";
      }

      // Select first tab by default
      if (schema?.layout?.tabs && schema.layout.tabs.length > 0) {
        activeTabId = schema.layout.tabs[0].id;
      }

      loading = false;
    })();
  });

  function getExpiredParams() {
    if (!schema) return [];

    const expiredParams: string[] = [];

    schema.inputs.forEach((input) => {
      const exists = availableParams.find((p) => p.id === input.grasshopperId);
      if (!exists) {
        input.isExpired = true;
        expiredParams.push(input.grasshopperId);
      }
    });

    schema.outputs.forEach((output) => {
      const exists = availableParams.find((p) => p.id === output.grasshopperId);
      if (!exists) {
        output.isExpired = true;
        expiredParams.push(output.grasshopperId);
      }
    });

    return expiredParams;
  }

  async function saveSchema() {
    if (!schema || !sessionId) return;

    const success = await api.saveSchema(sessionId, schema);
    if (success) {
      alert("Schema saved successfully!");
    } else {
      alert("Failed to save schema");
    }
  }

  function addTab() {
    if (!schema) return;

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
    if (!schema) return;

    // Find the tab being removed
    const tab = schema.layout.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // For each group in the tab, check if parameters are used elsewhere
    tab.groups.forEach((group) => {
      group.items.forEach((item) => {
        const isUsedElsewhere = schema!.layout.tabs.some(
          (t) =>
            t.id !== tabId &&
            t.groups.some((g) =>
              g.items.some((i) => i.parameterId === item.parameterId)
            )
        );

        // If not used anywhere else, remove from inputs/outputs
        if (!isUsedElsewhere) {
          if (item.type === "input") {
            schema!.inputs = schema!.inputs.filter(
              (i) => i.grasshopperId !== item.parameterId
            );
          } else if (item.type === "output") {
            schema!.outputs = schema!.outputs.filter(
              (o) => o.grasshopperId !== item.parameterId
            );
          }
        }
      });
    });

    // Remove the tab
    schema.layout.tabs = schema.layout.tabs.filter((t) => t.id !== tabId);

    // Update active tab if needed
    if (activeTabId === tabId && schema.layout.tabs.length > 0) {
      activeTabId = schema.layout.tabs[0].id;
    }
  }

  function addGroup(tabId: string) {
    if (!schema) return;

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
    schema.layout.tabs = [...schema.layout.tabs]; // Trigger reactivity
  }

  function removeGroup(tabId: string, groupId: string) {
    if (!schema) return;

    const tab = schema.layout.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    // Find the group being removed
    const group = tab.groups.find((g) => g.id === groupId);
    if (!group) return;

    // For each item in the group, check if it's used elsewhere
    group.items.forEach((item) => {
      const isUsedElsewhere = schema!.layout.tabs.some((t) =>
        t.groups.some(
          (g) =>
            g.id !== groupId &&
            g.items.some((i) => i.parameterId === item.parameterId)
        )
      );

      // If not used anywhere else, remove from inputs/outputs
      if (!isUsedElsewhere) {
        if (item.type === "input") {
          schema!.inputs = schema!.inputs.filter(
            (i) => i.grasshopperId !== item.parameterId
          );
        } else if (item.type === "output") {
          schema!.outputs = schema!.outputs.filter(
            (o) => o.grasshopperId !== item.parameterId
          );
        }
      }
    });

    // Remove the group from the tab
    tab.groups = tab.groups.filter((g) => g.id !== groupId);
    schema.layout.tabs = [...schema.layout.tabs];
  }

  function mapParamTypeToUIType(
    paramType: string,
    category: "input" | "output"
  ): string {
    if (category === "input") {
      if (paramType === "Number" || paramType === "Integer") return "slider";
      if (paramType === "Boolean") return "checkbox";
      if (paramType === "Text") return "text";
      return "text";
    } else {
      if (paramType === "Number" || paramType === "Integer") return "number";
      if (paramType === "Text") return "text";
      return "text";
    }
  }

  function handleParameterDrop(
    tabId: string,
    groupId: string,
    event: CustomEvent
  ) {
    if (!schema) return;

    const { type, data, sourceType, targetItem, dropPosition } = event.detail;
    if (type !== "parameter") return;

    const param = data as AvailableParameter;
    const tab = schema.layout.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const group = tab.groups.find((g) => g.id === groupId);
    if (!group) return;

    // Check if parameter already exists in this group
    const exists = group.items.some((i) => i.parameterId === param.id);
    if (exists) {
      alert("This parameter is already in this group");
      return;
    }

    // Add to schema.inputs or schema.outputs if not already there
    if (sourceType === "input") {
      const inputExists = schema.inputs.some(
        (i) => i.grasshopperId === param.id
      );
      if (!inputExists) {
        const newInput: InputParameter = {
          grasshopperId: param.id,
          name: param.nickname || param.name,
          nickname: param.nickname,
          type: mapParamTypeToUIType(param.paramType, "input") as any,
          grasshopperParamName: param.nickname,
          paramType: param.paramType,
          description: param.description,
          atLeast: param.atLeast,
          atMost: param.atMost,
          treeAccess: param.treeAccess,
          minimum: param.minimum,
          maximum: param.maximum,
          config: {
            min: param.minimum as number,
            max: param.maximum as number,
            step: 1,
          },
          default: param.default,
        };
        schema.inputs = [...schema.inputs, newInput];
      }
    } else if (sourceType === "output") {
      const outputExists = schema.outputs.some(
        (o) => o.grasshopperId === param.id
      );
      if (!outputExists) {
        const newOutput: OutputParameter = {
          grasshopperId: param.id,
          name: param.nickname || param.name,
          nickname: param.nickname,
          type: mapParamTypeToUIType(param.paramType, "output") as any,
          grasshopperParamName: param.nickname,
          paramType: param.paramType,
          description: param.description,
          config: {},
          // Outputs don't store default values - they show live data
        };
        schema.outputs = [...schema.outputs, newOutput];
      }
    }

    // Create new item
    const newItem: GroupItem = {
      id: crypto.randomUUID().substring(0, 8),
      parameterId: param.id,
      type: sourceType as "input" | "output",
      displayName: param.nickname || param.name,
      order: group.items.length,
      span: 1,
    };

    // Insert at specific position if dropping on an item
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
        // Target not found, add to end
        group.items = [...group.items, newItem];
      }
    } else {
      // No target, add to end
      group.items = [...group.items, newItem];
    }

    schema.layout.tabs = [...schema.layout.tabs];
  }

  function removeItem(tabId: string, groupId: string, itemId: string) {
    if (!schema) return;

    const tab = schema.layout.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const group = tab.groups.find((g) => g.id === groupId);
    if (!group) return;

    // Find the item being removed
    const item = group.items.find((i) => i.id === itemId);

    // Remove from group
    group.items = group.items.filter((i) => i.id !== itemId);
    schema.layout.tabs = [...schema.layout.tabs];

    // Check if this parameter is used anywhere else in the layout
    if (item) {
      const isUsedElsewhere = schema.layout.tabs.some((t) =>
        t.groups.some((g) =>
          g.items.some((i) => i.parameterId === item.parameterId)
        )
      );

      // If not used anywhere, remove from inputs/outputs
      if (!isUsedElsewhere) {
        if (item.type === "input") {
          schema.inputs = schema.inputs.filter(
            (i) => i.grasshopperId !== item.parameterId
          );
        } else if (item.type === "output") {
          schema.outputs = schema.outputs.filter(
            (o) => o.grasshopperId !== item.parameterId
          );
        }
      }
    }
  }

  function handleReorder(event: CustomEvent) {
    if (!schema) return;

    const {
      sourceItem,
      sourceTabId,
      sourceGroupId,
      targetItem,
      targetTabId,
      targetGroupId,
      dropPosition,
    } = event.detail;

    // Don't reorder if dropping on itself
    if (sourceItem.id === targetItem.id) return;

    const sourceTab = schema.layout.tabs.find((t) => t.id === sourceTabId);
    const targetTab = schema.layout.tabs.find((t) => t.id === targetTabId);
    if (!sourceTab || !targetTab) return;

    const sourceGroup = sourceTab.groups.find((g) => g.id === sourceGroupId);
    const targetGroup = targetTab.groups.find((g) => g.id === targetGroupId);
    if (!sourceGroup || !targetGroup) return;

    // Remove from source group
    const sourceIndex = sourceGroup.items.findIndex(
      (i) => i.id === sourceItem.id
    );
    if (sourceIndex < 0) return;

    const [movedItem] = sourceGroup.items.splice(sourceIndex, 1);

    // Add to target group based on drop position
    let targetIndex = targetGroup.items.findIndex(
      (i) => i.id === targetItem.id
    );

    if (targetIndex < 0) {
      // Target not found, add to end
      targetGroup.items.push(movedItem);
    } else {
      // Adjust index if we removed an item from the same group before the target
      if (sourceGroup === targetGroup && sourceIndex < targetIndex) {
        targetIndex--;
      }

      // Insert before or after based on dropPosition
      if (dropPosition === "before") {
        targetGroup.items.splice(targetIndex, 0, movedItem);
      } else {
        targetGroup.items.splice(targetIndex + 1, 0, movedItem);
      }
    }

    // Trigger reactivity
    schema.layout.tabs = [...schema.layout.tabs];
  }

  function getParameterInfo(parameterId: string) {
    return availableParams.find((p) => p.id === parameterId);
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
                  icon="📥"
                  parameters={availableInputs}
                  category="input"
                  emptyMessage="No contextual parameters found."
                />

                <ParameterList
                  title="Outputs"
                  icon="📤"
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
                  {#if schema.layout.tabs.length === 0}
                    <StateDisplay
                      type="empty"
                      size="large"
                      icon="📑"
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
                                  item.parameterId
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
              <Button variant="success" icon="💾" onclick={saveSchema}
                >Save Schema</Button
              >
            </div>
          </main>
        </div>
      {/if}
    </div>
  </PageContainer>
</DragDropContext>
