<script lang="ts">
  import type { PageProps } from "./$types";
  import TabLayout from "$lib/components/ui/TabLayout.svelte";
  import LegacyLayout from "$lib/components/ui/Layout.svelte";
  import {
    PageContainer,
    PageHeader,
    StateDisplay,
  } from "$lib/components/shared";
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

  let badgeConfig = $derived(
    solving
      ? { label: "⚙️ Solving...", variant: "solving" as const }
      : { label: "☁️ Rhino Compute", variant: "compute" as const }
  );
</script>

<PageContainer>
  <PageHeader title="Rhino Compute App" badge={badgeConfig} />

  {#if error}
    <div class="p-8">
      <StateDisplay type="error" size="medium" message={error} />
    </div>
  {/if}

  {#if schema}
    <div class="p-8 max-w-7xl mx-auto">
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
    <div class="p-8">
      <StateDisplay type="loading" size="large" message="Loading schema..." />
    </div>
  {/if}
</PageContainer>
