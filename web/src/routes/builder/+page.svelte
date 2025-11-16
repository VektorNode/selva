<script lang="ts">
  import { onMount } from "svelte";
  import { page } from "$app/stores";
  import { api } from "$lib/api/client";
  import DragDropContext from "$lib/components/DragDropContext.svelte";
  import DraggableParameter from "$lib/components/DraggableParameter.svelte";
  import DropZone from "$lib/components/DropZone.svelte";
  import type {
    UISchema,
    AvailableParameter,
    InputParameter,
    OutputParameter,
    TabConfig,
    GroupConfig,
    GroupItem,
  } from "$lib/types/schema";

  let sessionId = "";
  let schema: UISchema | null = null;
  let availableParams: AvailableParameter[] = [];
  let loading = true;
  let error = "";
  let activeTabId: string | null = null;

  onMount(async () => {
    sessionId = $page.url.searchParams.get("session") || "";

    if (!sessionId) {
      error = "No session ID provided";
      loading = false;
      return;
    }

    const [schemaData, availableData] = await Promise.all([
      api.getSchema(sessionId),
      api.getAvailableParameters(sessionId),
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
  });

  async function saveSchema() {
    if (!schema || !sessionId) return;

    console.log("Saving schema:", schema);
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
    schema.layout.tabs = schema.layout.tabs.filter((t) => t.id !== tabId);
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

    const { type, data, sourceType } = event.detail;
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

    // Add to group layout
    const newItem: GroupItem = {
      id: crypto.randomUUID().substring(0, 8),
      parameterId: param.id,
      type: sourceType as "input" | "output",
      displayName: param.nickname || param.name,
      order: group.items.length,
      span: 1,
    };

    group.items = [...group.items, newItem];
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

  function moveItemUp(tabId: string, groupId: string, itemId: string) {
    if (!schema) return;

    const tab = schema.layout.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const group = tab.groups.find((g) => g.id === groupId);
    if (!group) return;

    const index = group.items.findIndex((i) => i.id === itemId);
    if (index <= 0) return;

    [group.items[index], group.items[index - 1]] = [
      group.items[index - 1],
      group.items[index],
    ];
    group.items = [...group.items];
    schema.layout.tabs = [...schema.layout.tabs];
  }

  function moveItemDown(tabId: string, groupId: string, itemId: string) {
    if (!schema) return;

    const tab = schema.layout.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const group = tab.groups.find((g) => g.id === groupId);
    if (!group) return;

    const index = group.items.findIndex((i) => i.id === itemId);
    if (index < 0 || index >= group.items.length - 1) return;

    [group.items[index], group.items[index + 1]] = [
      group.items[index + 1],
      group.items[index],
    ];
    group.items = [...group.items];
    schema.layout.tabs = [...schema.layout.tabs];
  }

  function getParameterInfo(parameterId: string) {
    return availableParams.find((p) => p.id === parameterId);
  }

  // Filter out parameters that are already in the schema
  $: usedInputIds = new Set(schema?.inputs.map((i) => i.grasshopperId) || []);
  $: usedOutputIds = new Set(schema?.outputs.map((o) => o.grasshopperId) || []);

  $: availableInputs = availableParams.filter(
    (p) => p.category === "input" && !usedInputIds.has(p.id)
  );
  $: availableOutputs = availableParams.filter(
    (p) => p.category === "output" && !usedOutputIds.has(p.id)
  );
  $: activeTab = schema?.layout?.tabs?.find((t) => t.id === activeTabId);
</script>

<DragDropContext>
  <div class="container">
    <header>
      <h1>🎨 UI Builder</h1>
      {#if sessionId}
        <p class="session-info">Session: {sessionId}</p>
      {/if}
    </header>

    {#if loading}
      <div class="loading">Loading schema...</div>
    {:else if schema}
      <div class="builder-layout">
        {#if error}
          <div class="warning">{error}</div>
        {/if}

        <!-- Left Sidebar: Schema Info & Available Parameters -->
        <aside class="sidebar">
          <div class="panel">
            <h2>Schema Information</h2>
            <div class="form-group">
              <label>Name</label>
              <input type="text" bind:value={schema.name} />
            </div>
            <div class="form-group">
              <label>Description</label>
              <textarea bind:value={schema.description}></textarea>
            </div>
            <div class="form-group">
              <label>
                <input type="checkbox" bind:checked={schema.enable3dViewer} />
                Enable 3D Viewer Output
              </label>
            </div>

            <div class="panel">
              <h2>Available Parameters</h2>
              <p class="info-text">Drag parameters into groups below</p>

              <div class="section">
                <h3>📥 Inputs ({availableInputs.length})</h3>
                {#if availableInputs.length === 0}
                  <p class="empty">No contextual parameters found.</p>
                {:else}
                  <div class="parameter-list">
                    {#each availableInputs as param}
                      <DraggableParameter parameter={param} category="input" />
                    {/each}
                  </div>
                {/if}
              </div>

              <div class="section">
                <h3>📤 Outputs ({availableOutputs.length})</h3>
                {#if availableOutputs.length === 0}
                  <p class="empty">No context output components found.</p>
                {:else}
                  <div class="parameter-list">
                    {#each availableOutputs as param}
                      <DraggableParameter parameter={param} category="output" />
                    {/each}
                  </div>
                {/if}
              </div>
            </div>
          </div>
        </aside>

        <!-- Main Area: Tab & Group Builder -->
        <main class="main-area">
          <div class="panel">
            <div class="panel-header">
              <h2>Layout Builder</h2>
              <button class="btn-primary" on:click={addTab}> + Add Tab </button>
            </div>

            {#if schema.layout.tabs.length === 0}
              <div class="empty-state-large">
                <span class="icon">📑</span>
                <h3>No tabs yet</h3>
                <p>Click "Add Tab" to create your first tab</p>
              </div>
            {:else}
              <!-- Tab Navigation -->
              <div class="tabs-nav">
                {#each schema.layout.tabs as tab}
                  <div class="tab-wrapper">
                    <button
                      class="tab-button"
                      class:active={activeTabId === tab.id}
                      on:click={() => (activeTabId = tab.id)}
                    >
                      {#if tab.icon}{tab.icon}{/if}
                      <input
                        type="text"
                        bind:value={tab.label}
                        on:click={(e) => e.stopPropagation()}
                        class="tab-label-input"
                      />
                    </button>
                    <button
                      class="btn-tab-remove"
                      on:click={() => removeTab(tab.id)}
                      title="Remove tab"
                    >
                      ×
                    </button>
                  </div>
                {/each}
              </div>

              <!-- Active Tab Content -->
              {#if activeTab}
                <div class="tab-content">
                  <div class="tab-controls">
                    <button
                      class="btn-secondary"
                      on:click={() => addGroup(activeTab.id)}
                    >
                      + Add Group
                    </button>
                  </div>

                  {#if activeTab.groups.length === 0}
                    <div class="empty-state-medium">
                      <span class="icon">📦</span>
                      <p>
                        No groups yet. Click "Add Group" to organize your
                        parameters.
                      </p>
                    </div>
                  {:else}
                    <div class="groups-container">
                      {#each activeTab.groups as group}
                        <div class="group-card">
                          <div class="group-header">
                            <div class="group-title-section">
                              <input
                                type="text"
                                bind:value={group.label}
                                class="group-label-input"
                                placeholder="Group name"
                              />
                              <input
                                type="text"
                                bind:value={group.description}
                                class="group-description-input"
                                placeholder="Description (optional)"
                              />
                            </div>
                            <div class="group-controls">
                              <label class="columns-control">
                                Columns:
                                <input
                                  type="number"
                                  bind:value={group.columns}
                                  min="1"
                                  max="4"
                                />
                              </label>
                              <button
                                class="btn-icon"
                                on:click={() =>
                                  removeGroup(activeTab.id, group.id)}
                                title="Remove group"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>

                          <div class="group-body">
                            <DropZone
                              isEmpty={group.items.length === 0}
                              label="Drag parameters here"
                              on:drop={(e) =>
                                handleParameterDrop(activeTab.id, group.id, e)}
                            >
                              <div
                                class="items-grid"
                                style="grid-template-columns: repeat({group.columns}, 1fr);"
                              >
                                {#each group.items as item}
                                  {@const paramInfo = getParameterInfo(
                                    item.parameterId
                                  )}
                                  <div class="group-item">
                                    <div class="item-header">
                                      <span
                                        class="item-type-badge"
                                        class:input={item.type === "input"}
                                        class:output={item.type === "output"}
                                      >
                                        {item.type === "input" ? "📥" : "📤"}
                                      </span>
                                      <input
                                        type="text"
                                        bind:value={item.displayName}
                                        class="item-name-input"
                                        placeholder={paramInfo?.name || ""}
                                      />
                                    </div>
                                    {#if paramInfo}
                                      <div class="item-info">
                                        <span class="param-type"
                                          >{paramInfo.paramType}</span
                                        >
                                        <span class="param-original"
                                          >{paramInfo.nickname}</span
                                        >
                                      </div>
                                    {/if}
                                    <div class="item-actions">
                                      <button
                                        class="btn-mini"
                                        on:click={() =>
                                          moveItemUp(
                                            activeTab.id,
                                            group.id,
                                            item.id
                                          )}
                                        title="Move up"
                                      >
                                        ↑
                                      </button>
                                      <button
                                        class="btn-mini"
                                        on:click={() =>
                                          moveItemDown(
                                            activeTab.id,
                                            group.id,
                                            item.id
                                          )}
                                        title="Move down"
                                      >
                                        ↓
                                      </button>
                                      <button
                                        class="btn-mini danger"
                                        on:click={() =>
                                          removeItem(
                                            activeTab.id,
                                            group.id,
                                            item.id
                                          )}
                                        title="Remove"
                                      >
                                        ×
                                      </button>
                                    </div>
                                  </div>
                                {/each}
                              </div>
                            </DropZone>
                          </div>
                        </div>
                      {/each}
                    </div>
                  {/if}
                </div>
              {/if}
            {/if}
          </div>

          <div class="actions">
            <button class="btn-success" on:click={saveSchema}>
              💾 Save Schema
            </button>
          </div>
        </main>
      </div>
    {/if}
  </div>
</DragDropContext>

<style>
  .container {
    min-height: 100vh;
    background: #f5f7fa;
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
  }

  header {
    background: white;
    border-bottom: 1px solid #e1e4e8;
    padding: 1.5rem 2rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }

  h1 {
    font-size: 1.75rem;
    margin: 0 0 0.5rem 0;
    color: #24292e;
  }

  .session-info {
    color: #586069;
    font-size: 0.9rem;
    margin: 0;
  }

  .loading {
    padding: 4rem 2rem;
    text-align: center;
    color: #586069;
  }

  .warning {
    padding: 1rem;
    background: #fff3cd;
    color: #856404;
    border: 1px solid #ffeaa7;
    border-radius: 6px;
    margin-bottom: 1rem;
  }

  .builder-layout {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 1.5rem;
    padding: 1.5rem;
    max-width: 1800px;
    margin: 0 auto;
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .panel {
    background: white;
    border: 1px solid #e1e4e8;
    border-radius: 8px;
    padding: 1.5rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  h2 {
    font-size: 1.25rem;
    margin: 0 0 1rem 0;
    color: #24292e;
  }

  h3 {
    font-size: 1rem;
    margin: 0 0 0.75rem 0;
    color: #586069;
    font-weight: 600;
  }

  .info-text {
    color: #586069;
    font-size: 0.85rem;
    margin-bottom: 1rem;
  }

  .form-group {
    margin-bottom: 1rem;
  }

  label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
    font-size: 0.9rem;
    color: #24292e;
  }

  input[type="text"],
  input[type="number"],
  textarea {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #d1d5da;
    border-radius: 4px;
    font-family: inherit;
    font-size: 0.9rem;
  }

  input:focus,
  textarea:focus {
    outline: none;
    border-color: #0366d6;
    box-shadow: 0 0 0 3px rgba(3, 102, 214, 0.1);
  }

  textarea {
    min-height: 60px;
    resize: vertical;
  }

  .section {
    margin-bottom: 1.5rem;
  }

  .section:last-child {
    margin-bottom: 0;
  }

  .parameter-list {
    display: flex;
    flex-direction: column;
  }

  .empty {
    color: #959da5;
    font-style: italic;
    font-size: 0.85rem;
  }

  .empty-state-large,
  .empty-state-medium {
    text-align: center;
    padding: 3rem 2rem;
    color: #959da5;
  }

  .empty-state-large .icon,
  .empty-state-medium .icon {
    font-size: 3rem;
    display: block;
    margin-bottom: 1rem;
    opacity: 0.3;
  }

  .tabs-nav {
    display: flex;
    gap: 0.25rem;
    margin-bottom: 1.5rem;
    border-bottom: 2px solid #e1e4e8;
    overflow-x: auto;
  }

  .tab-wrapper {
    display: flex;
    align-items: center;
    gap: 0;
    position: relative;
  }

  .tab-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: none;
    border: none;
    border-bottom: 3px solid transparent;
    cursor: pointer;
    color: #586069;
    font-weight: 500;
    transition: all 0.2s;
    white-space: nowrap;
  }

  .tab-button:hover {
    color: #24292e;
    background: #f6f8fa;
  }

  .tab-button.active {
    color: #0366d6;
    border-bottom-color: #0366d6;
  }

  .btn-tab-remove {
    background: none;
    border: none;
    font-size: 1.25rem;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    color: #586069;
    transition: color 0.2s;
    margin-left: -0.25rem;
  }

  .btn-tab-remove:hover {
    color: #d73a49;
  }

  .tab-label-input {
    border: none;
    background: transparent;
    padding: 0;
    font-weight: 500;
    font-size: 0.9rem;
    width: auto;
    min-width: 60px;
  }

  .tab-label-input:focus {
    box-shadow: none;
    border-bottom: 1px solid #0366d6;
  }

  .tab-content {
    animation: fadeIn 0.2s;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .tab-controls {
    margin-bottom: 1.5rem;
    display: flex;
    justify-content: flex-end;
  }

  .groups-container {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .group-card {
    border: 2px solid #e1e4e8;
    border-radius: 8px;
    background: #fafbfc;
    overflow: hidden;
  }

  .group-header {
    padding: 1rem;
    background: white;
    border-bottom: 1px solid #e1e4e8;
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
  }

  .group-title-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .group-label-input {
    font-weight: 600;
    font-size: 1rem;
    border: 1px solid transparent;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
  }

  .group-label-input:hover {
    border-color: #d1d5da;
  }

  .group-description-input {
    font-size: 0.85rem;
    color: #586069;
    border: 1px solid transparent;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
  }

  .group-description-input:hover {
    border-color: #d1d5da;
  }

  .group-controls {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .columns-control {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
  }

  .columns-control input {
    width: 50px;
  }

  .group-body {
    padding: 1rem;
  }

  .items-grid {
    display: grid;
    gap: 0.75rem;
  }

  .group-item {
    background: white;
    border: 1px solid #d1d5da;
    border-radius: 6px;
    padding: 0.75rem;
    transition: all 0.2s;
  }

  .group-item:hover {
    border-color: #0366d6;
    box-shadow: 0 2px 6px rgba(3, 102, 214, 0.1);
  }

  .item-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .item-type-badge {
    font-size: 1rem;
  }

  .item-name-input {
    flex: 1;
    font-weight: 500;
    border: 1px solid transparent;
    padding: 0.25rem 0.5rem;
    border-radius: 3px;
    font-size: 0.9rem;
  }

  .item-name-input:hover {
    border-color: #d1d5da;
  }

  .item-info {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
    font-size: 0.8rem;
  }

  .param-type {
    background: #e3f2fd;
    color: #0366d6;
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
  }

  .param-original {
    color: #959da5;
    font-family: monospace;
  }

  .item-actions {
    display: flex;
    gap: 0.25rem;
    justify-content: flex-end;
  }

  .actions {
    margin-top: 1.5rem;
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
  }

  /* Button Styles */
  .btn-primary,
  .btn-secondary,
  .btn-success {
    padding: 0.6rem 1.2rem;
    border: none;
    border-radius: 6px;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-primary {
    background: #0366d6;
    color: white;
  }

  .btn-primary:hover {
    background: #0256c4;
  }

  .btn-secondary {
    background: #f6f8fa;
    color: #24292e;
    border: 1px solid #d1d5da;
  }

  .btn-secondary:hover {
    background: #e1e4e8;
  }

  .btn-success {
    background: #28a745;
    color: white;
  }

  .btn-success:hover {
    background: #22863a;
  }

  .btn-icon {
    background: none;
    border: none;
    font-size: 1.25rem;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    color: #586069;
    transition: color 0.2s;
  }

  .btn-icon:hover {
    color: #d73a49;
  }

  .btn-mini {
    background: #f6f8fa;
    border: 1px solid #d1d5da;
    border-radius: 3px;
    padding: 0.2rem 0.4rem;
    font-size: 0.8rem;
    cursor: pointer;
    color: #24292e;
    transition: all 0.2s;
  }

  .btn-mini:hover {
    background: #e1e4e8;
  }

  .btn-mini.danger:hover {
    background: #d73a49;
    color: white;
    border-color: #d73a49;
  }

  .main-area {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
</style>
