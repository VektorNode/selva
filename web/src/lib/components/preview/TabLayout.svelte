<script lang="ts">
  import type {
    UISchema,
    InputParamSchema,
    OutputParamSchema,
  } from "$lib/types/schema";
  import StateDisplay from "../ui/StateDisplay.svelte";
  import InputControl from "./InputControl.svelte";
  import OutputDisplay from "./OutputDisplay.svelte";

  interface Props {
    schema: UISchema;
    values: Record<string, any>;
    onValueChange: (paramId: string, value: any) => void;
    debounceSliders?: boolean;
  }

  let {
    schema,
    values = $bindable(),
    onValueChange,
    debounceSliders = false,
  }: Props = $props();

  let activeTabId: string | null = $state(null);

  // Track collapsed state for each group (keyed by group id)
  let collapsedGroups = $state<Record<string, boolean>>({});

  // Initialize first tab as active and set initial collapsed states
  $effect(() => {
    if (schema.layout.tabs && schema.layout.tabs.length > 0 && !activeTabId) {
      activeTabId = schema.layout.tabs[0].id;
    }

    // Initialize collapsed states from schema
    if (schema.layout.tabs) {
      const initialCollapsed: Record<string, boolean> = {};
      schema.layout.tabs.forEach(tab => {
        tab.groups.forEach(group => {
          if (!(group.id in collapsedGroups)) {
            initialCollapsed[group.id] = group.collapsed;
          }
        });
      });
      if (Object.keys(initialCollapsed).length > 0) {
        collapsedGroups = { ...collapsedGroups, ...initialCollapsed };
      }
    }
  });

  function toggleGroup(groupId: string) {
    collapsedGroups = {
      ...collapsedGroups,
      [groupId]: !collapsedGroups[groupId]
    };
  }

  const activeTab = $derived(
    schema.layout.tabs?.find((t) => t.id === activeTabId)
  );

  // Lookup by paramId (GUID from LayoutItem)
  function getInputById(paramId: string): InputParamSchema | undefined {
    return schema.inputs.find((i) => i.id === paramId);
  }

  function getOutputById(paramId: string): OutputParamSchema | undefined {
    return schema.outputs.find((o) => o.id === paramId);
  }
</script>

<div class="rounded-lg shadow-sm overflow-hidden bg-card w-full">
  <!-- Tab Navigation -->
  <div class="flex border-b-2 border-border bg-muted overflow-x-auto">
    {#each schema.layout.tabs || [] as tab}
      <button
        class={`flex items-center gap-2 px-6 py-4 border-b-4 transition-all whitespace-nowrap font-medium ${
          activeTabId === tab.id
            ? "text-primary border-primary bg-card"
            : "text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/80"
        }`}
        onclick={() => (activeTabId = tab.id)}
      >
        {#if tab.icon}<span class="text-lg">{tab.icon}</span>{/if}
        {tab.label}
      </button>
    {/each}
  </div>

  <!-- Tab Content -->
  {#if activeTab}
    <div class="p-8 animate-[fadeIn_0.3s]">
      {#if activeTab.groups.length === 0}
        <StateDisplay
          type="empty"
          size="medium"
          message="This tab has no groups configured."
        />
      {:else}
        <div class="flex flex-col gap-8">
          {#each activeTab.groups as group}
            <div class="border border-border rounded-lg overflow-hidden">
              <!-- Group Header -->
              <button
                class="w-full bg-muted px-6 py-4 border-b border-border flex items-center justify-between cursor-pointer hover:bg-muted/80 transition-colors"
                onclick={() => toggleGroup(group.id)}
              >
                <div class="text-left">
                  <h3 class="m-0 mb-1 text-lg text-foreground font-semibold">
                    {group.label}
                  </h3>
                  {#if group.description}
                    <p class="m-0 text-sm text-muted-foreground">{group.description}</p>
                  {/if}
                </div>
                <span class="text-muted-foreground text-xl transition-transform duration-200 {collapsedGroups[group.id] ? '' : 'rotate-180'}">
                  ▼
                </span>
              </button>

              <!-- Group Content -->
              {#if !collapsedGroups[group.id]}
                <div
                  class="grid gap-6 p-6 bg-card animate-[fadeIn_0.2s]"
                  style="grid-template-columns: repeat({group.columns}, 1fr);"
                >
                  {#each group.items as layoutItem}
                    {#if layoutItem.type === "input"}
                      {@const input = getInputById(layoutItem.paramId)}
                      {#if input}
                        <InputControl
                          item={layoutItem}
                          bind:value={values[input.id]}
                          displayName={layoutItem.displayName}
                          onChange={onValueChange}
                          debounceMs={debounceSliders &&
                          layoutItem.widgetType === "slider"
                            ? 20
                            : 0}
                        />
                      {/if}
                    {:else if layoutItem.type === "output"}
                      {@const output = getOutputById(layoutItem.paramId)}
                      {#if output}
                        <OutputDisplay
                          item={layoutItem}
                          value={values[output.id]}
                          displayName={layoutItem.displayName}
                        />
                      {/if}
                    {/if}
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
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
</style>
