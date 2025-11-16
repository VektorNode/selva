<script lang="ts">
  import type { UISchema } from "$lib/types/schema";
  import InputControl from "./InputControl.svelte";
  import OutputDisplay from "./OutputDisplay.svelte";

  interface Props {
    schema: UISchema;
    values: Record<string, any>;
    onValueChange: (parameterName: string, value: any) => void;
    debounceSliders?: boolean;
  }

  let { schema, values = $bindable(), onValueChange, debounceSliders = false }: Props = $props();
</script>

<div class="legacy-layout">
  <div class="inputs-panel">
    <h2>Inputs</h2>
    {#if schema.inputs.length === 0}
      <p class="empty">No inputs available</p>
    {:else}
      <div class="inputs-grid">
        {#each schema.inputs as input}
          <div class="input-wrapper">
            <InputControl
              {input}
              bind:value={values[input.name]}
              onChange={onValueChange}
              debounceMs={debounceSliders && input.type === "slider" ? 100 : 0}
            />
            <span class="current-value">{values[input.name]}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <div class="outputs-panel">
    <h2>Outputs</h2>
    {#if schema.outputs.length === 0}
      <p class="empty">No outputs available</p>
    {:else}
      <div class="outputs-grid">
        {#each schema.outputs as output}
          <OutputDisplay
            {output}
            value={values[output.name]}
          />
        {/each}
      </div>
    {/if}
  </div>
</div>

<style>
  .legacy-layout {
    display: grid;
    gap: 2rem;
    grid-template-columns: 1fr 1fr;
  }

  .inputs-panel,
  .outputs-panel {
    background: white;
    border: 1px solid #e1e4e8;
    border-radius: 8px;
    padding: 1.5rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }

  h2 {
    font-size: 1.25rem;
    margin: 0 0 1rem 0;
    color: #24292e;
  }

  .inputs-grid,
  .outputs-grid {
    display: grid;
    gap: 1.5rem;
  }

  .input-wrapper {
    display: grid;
    gap: 0.5rem;
  }

  .current-value {
    font-size: 0.85rem;
    color: #586069;
    font-family: monospace;
  }

  .empty {
    color: #959da5;
    font-style: italic;
  }
</style>
