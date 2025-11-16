<script lang="ts">
  import type { UISchema, InputParameter, OutputParameter } from "$lib/types/schema";
  import InputControl from "./InputControl.svelte";
  import OutputDisplay from "./OutputDisplay.svelte";

  interface Props {
    schema: UISchema;
    values: Record<string, any>;
    onValueChange: (parameterName: string, value: any) => void;
    debounceSliders?: boolean;
  }

  let { schema, values = $bindable(), onValueChange, debounceSliders = false }: Props = $props();

  let activeTabId: string | null = $state(null);

  // Initialize first tab as active
  $effect(() => {
    if (schema.layout.tabs && schema.layout.tabs.length > 0 && !activeTabId) {
      activeTabId = schema.layout.tabs[0].id;
    }
  });

  const activeTab = $derived(schema.layout.tabs?.find((t) => t.id === activeTabId));

  // Lookup by parameterId (which could be grasshopperId or name)
  // We'll match against both grasshopperId and name for backward compatibility
  function getInputById(id: string): InputParameter | undefined {
    return schema.inputs.find((i) => i.grasshopperId === id || i.name === id);
  }

  function getOutputById(id: string): OutputParameter | undefined {
    return schema.outputs.find((o) => o.grasshopperId === id || o.name === id);
  }
</script>

<div class="tabs-container">
  <div class="tabs-nav">
    {#each schema.layout.tabs || [] as tab}
      <button
        class="tab-button"
        class:active={activeTabId === tab.id}
        onclick={() => (activeTabId = tab.id)}
      >
        {#if tab.icon}<span class="tab-icon">{tab.icon}</span>{/if}
        {tab.label}
      </button>
    {/each}
  </div>

  {#if activeTab}
    <div class="tab-content">
      {#if activeTab.groups.length === 0}
        <div class="empty-state">
          <p>This tab has no groups configured.</p>
        </div>
      {:else}
        <div class="groups-container">
          {#each activeTab.groups as group}
            <div class="group">
              <div class="group-header">
                <h3>{group.label}</h3>
                {#if group.description}
                  <p class="group-description">{group.description}</p>
                {/if}
              </div>

              <div
                class="group-content"
                style="grid-template-columns: repeat({group.columns}, 1fr);"
              >
                {#each group.items as item}
                  {#if item.type === "input"}
                    {@const input = getInputById(item.parameterId)}
                    {#if input}
                      <InputControl
                        {input}
                        bind:value={values[input.name]}
                        displayName={item.displayName}
                        onChange={onValueChange}
                        debounceMs={debounceSliders && input.type === "slider" ? 100 : 0}
                      />
                    {/if}
                  {:else if item.type === "output"}
                    {@const output = getOutputById(item.parameterId)}
                    {#if output}
                      <OutputDisplay
                        {output}
                        value={values[output.name]}
                        displayName={item.displayName}
                      />
                    {/if}
                  {/if}
                {/each}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tabs-container {
    background: white;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    overflow: hidden;
  }

  .tabs-nav {
    display: flex;
    border-bottom: 2px solid #e1e4e8;
    background: #fafbfc;
    overflow-x: auto;
  }

  .tab-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem 1.5rem;
    background: none;
    border: none;
    border-bottom: 3px solid transparent;
    cursor: pointer;
    color: #586069;
    font-weight: 500;
    font-size: 0.95rem;
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
    background: white;
  }

  .tab-icon {
    font-size: 1.2rem;
  }

  .tab-content {
    padding: 2rem;
    animation: fadeIn 0.3s;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .groups-container {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .group {
    border: 1px solid #e1e4e8;
    border-radius: 8px;
    overflow: hidden;
  }

  .group-header {
    background: #fafbfc;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid #e1e4e8;
  }

  .group-header h3 {
    margin: 0 0 0.25rem 0;
    font-size: 1.1rem;
    color: #24292e;
  }

  .group-description {
    margin: 0;
    font-size: 0.85rem;
    color: #586069;
  }

  .group-content {
    display: grid;
    gap: 1.5rem;
    padding: 1.5rem;
    background: white;
  }

  .empty-state {
    text-align: center;
    padding: 3rem 2rem;
    color: #959da5;
  }
</style>
