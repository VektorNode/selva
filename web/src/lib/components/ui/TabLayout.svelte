<script lang="ts">
  import type {
    UISchema,
    InputParameter,
    OutputParameter,
  } from "$lib/types/schema";
  import InputControl from "./InputControl.svelte";
  import OutputDisplay from "./OutputDisplay.svelte";
  import { StateDisplay } from "$lib/components/shared";

  interface Props {
    schema: UISchema;
    values: Record<string, any>;
    onValueChange: (parameterName: string, value: any) => void;
    debounceSliders?: boolean;
  }

  let {
    schema,
    values = $bindable(),
    onValueChange,
    debounceSliders = false,
  }: Props = $props();

  let activeTabId: string | null = $state(null);

  // Initialize first tab as active
  $effect(() => {
    if (schema.layout.tabs && schema.layout.tabs.length > 0 && !activeTabId) {
      activeTabId = schema.layout.tabs[0].id;
    }
  });

  const activeTab = $derived(
    schema.layout.tabs?.find((t) => t.id === activeTabId)
  );

  // Lookup by parameterId (which could be grasshopperId or name)
  // We'll match against both grasshopperId and name for backward compatibility
  function getInputById(id: string): InputParameter | undefined {
    return schema.inputs.find((i) => i.grasshopperId === id || i.name === id);
  }

  function getOutputById(id: string): OutputParameter | undefined {
    return schema.outputs.find((o) => o.grasshopperId === id || o.name === id);
  }
</script>

<div class="bg-white rounded-lg shadow-sm overflow-hidden">
  <!-- Tab Navigation -->
  <div class="flex border-b-2 border-gray-200 bg-gray-50 overflow-x-auto">
    {#each schema.layout.tabs || [] as tab}
      <button
        class={` flex items-center gap-2 px-6 py-4 border-b-3 transition-all whitespace-nowrap font-medium ${activeTabId === tab.id ? "text-blue-600 border-blue-600 bg-white" : "text-gray-600 border-transparent hover:text-gray-900 hover:bg-gray-100"}`}
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
            <div class="border border-gray-200 rounded-lg overflow-hidden">
              <!-- Group Header -->
              <div class="bg-gray-50 px-6 py-4 border-b border-gray-200">
                <h3 class="m-0 mb-1 text-lg text-gray-900 font-semibold">
                  {group.label}
                </h3>
                {#if group.description}
                  <p class="m-0 text-sm text-gray-600">{group.description}</p>
                {/if}
              </div>

              <!-- Group Content -->
              <div
                class="grid gap-6 p-6 bg-white"
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
                        debounceMs={debounceSliders && input.type === "slider"
                          ? 100
                          : 0}
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
  /* Fade-in animation for tab transitions */
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
