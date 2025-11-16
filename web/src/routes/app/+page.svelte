<script lang="ts">
  import type { PageProps } from "./$types";
  import TabLayout from "$lib/components/ui/TabLayout.svelte";
  import LegacyLayout from "$lib/components/ui/LegacyLayout.svelte";
  import {
    inputsToDataTrees,
    solveGrasshopperDefinition,
    GrasshopperResponseProcessor,
  } from "rhino-compute-core";

  let { data }: PageProps = $props();

  let schema = $state(data.schema);
  let values: Record<string, any> = $state({});
  let solving = $state(false);
  let error = $state("");

  // Initialize values with defaults
  $effect(() => {
    if (schema) {
      const initialValues: Record<string, any> = {};

      schema.inputs.forEach((input) => {
        initialValues[input.name] =
          input.default ?? getDefaultValue(input.type);
      });

      schema.outputs.forEach((output) => {
        initialValues[output.name] = null;
      });

      values = initialValues;
    }
  });

  function getDefaultValue(type: string) {
    switch (type) {
      case "number":
      case "slider":
        return 0;
      case "checkbox":
        return false;
      case "text":
        return "";
      case "color":
        return "#000000";
      default:
        return null;
    }
  }

  async function handleValueChange(parameterName: string, value: any) {
    values[parameterName] = value;

    // Solve with Rhino Compute
    try {
      solving = true;
      error = "";

      // Convert current values to data trees
      const inputTree = inputsToDataTrees(
        schema.inputs.map((input) => ({
          ...input,
          default: values[input.name],
        }))
      );

      // Solve the definition
      const solvedDefinition = await solveGrasshopperDefinition(
        inputTree,
        "http://localhost:5173/builder_test.gh",
        { serverUrl: "http://localhost:5000/" }
      );

      // Process outputs
      const processor = new GrasshopperResponseProcessor(solvedDefinition);
      const outputValues = processor.getValues();

      console.log("Solved outputs:", outputValues);

      // Update output values
      values = { ...values, ...outputValues.values };
    } catch (err) {
      error = err instanceof Error ? err.message : "Failed to solve definition";
      console.error("Solve error:", err);
    } finally {
      solving = false;
    }
  }
</script>

<div class="container">
  <header>
    <h1>Rhino Compute App</h1>
    <p class="session-info">
      <span class="connection-badge" class:solving>
        {solving ? "⚙️ Solving..." : "☁️ Rhino Compute"}
      </span>
    </p>
  </header>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if schema}
    <div class="preview">
      {#if schema.layout.type === "tabbed" && schema.layout.tabs && schema.layout.tabs.length > 0}
        <TabLayout
          {schema}
          bind:values
          onValueChange={handleValueChange}
          debounceSliders={false}
        />
      {:else}
        <LegacyLayout
          {schema}
          bind:values
          onValueChange={handleValueChange}
          debounceSliders={false}
        />
      {/if}
    </div>
  {:else}
    <div class="loading">Loading schema...</div>
  {/if}
</div>

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
    display: flex;
    align-items: center;
    gap: 1rem;
    margin: 0;
  }

  .connection-badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
    background: #2196f3;
    color: white;
  }

  .connection-badge.solving {
    background: #ff9800;
  }

  .loading,
  .error {
    padding: 4rem 2rem;
    text-align: center;
    background: white;
    border-radius: 8px;
    margin: 2rem;
  }

  .error {
    background: #fee;
    color: #c00;
  }

  .preview {
    padding: 2rem;
    max-width: 1400px;
    margin: 0 auto;
  }
</style>
