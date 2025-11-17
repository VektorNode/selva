<script lang="ts">
  import type { PageProps } from "./$types";
  import TabLayout from "$lib/components/ui/TabLayout.svelte";
  import Layout from "$lib/components/ui/Layout.svelte";
  import {
    PageContainer,
    PageHeader,
    StateDisplay,
  } from "$lib/components/shared";
  import {
    inputsToDataTrees,
    solveGrasshopperDefinition,
    GrasshopperResponseProcessor,
    type NumericInputType,
    type TextInputType,
    type BooleanInputType,
    type ValueListInputType,
    type InputParam,
    initThree,
    updateScene,
  } from "rhino-compute-core";
  import type { InputParameter } from "$lib/types/schema";
  import * as THREE from "three";
  import type { OrbitControls } from "three/examples/jsm/Addons.js";
  import { onMount } from "svelte";

  let { data }: PageProps = $props();

  let schema = $state(data.schema);
  let values: Record<string, any> = $state({});
  let solving = $state(false);
  let error = $state("");
  let canvas: HTMLCanvasElement | null = $state(null);

  let scene: THREE.Scene | null = $state(null);
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;
  let viewerInitialized = $state(false);

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

  function transformInputParameter(
    input: InputParameter,
    value: any
  ): InputParam {
    const base = {
      description: input.description || "",
      name: input.name,
      nickname: input.nickname || null,
      treeAccess: input.treeAccess || false,
      groupName: input.groupName || "",
    };

    // Determine paramType and create the appropriate InputParam type
    if (input.paramType === "Number" || input.paramType === "Integer") {
      return {
        ...base,
        paramType: input.paramType as "Number" | "Integer",
        minimum: input.minimum,
        maximum: input.maximum,
        atLeast: input.atLeast,
        atMost: input.atMost,
        stepSize: input.config?.step,
        default: value ?? input.default,
      } as NumericInputType;
    } else if (input.paramType === "Text") {
      return {
        ...base,
        paramType: "Text",
        default: value ?? input.default ?? "",
      } as TextInputType;
    } else if (input.paramType === "Boolean") {
      return {
        ...base,
        paramType: "Boolean",
        default: value ?? input.default ?? false,
      } as BooleanInputType;
    } else if (input.paramType === "ValueList") {
      return {
        ...base,
        paramType: "ValueList",
        values:
          input.config?.options?.reduce(
            (acc: any, opt: any) => ({ ...acc, [opt]: opt }),
            {}
          ) || {},
        default: value ?? input.default,
      } as ValueListInputType;
    }

    // Default fallback
    // throw new Error(`Unsupported paramType: ${input.paramType}`);
  }

  async function handleValueChange(parameterName: string, value: any) {
    values[parameterName] = value;

    // Solve with Rhino Compute
    try {
      solving = true;
      error = "";

      // Convert current values to data trees
      const inputTree = inputsToDataTrees(
        schema.inputs
          .filter((input) => input.paramType)
          .map((input) => transformInputParameter(input, values[input.name]))
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

      if (schema.enable3dViewer && scene) {
        const meshes = processor.extractMeshesFromResponse();
        updateScene(scene, meshes, camera, controls, viewerInitialized);
        viewerInitialized = true;
      }

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

  onMount(() => {
    if (schema.enable3dViewer && canvas && !viewerInitialized) {
      const threeSetup = initThree(canvas);
      scene = threeSetup.scene;
      camera = threeSetup.camera;
      controls = threeSetup.controls;
    }
  });
</script>

<PageContainer>
  <PageHeader title="Rhino Compute App" badge={badgeConfig} />

  {#if error}
    <div class="p-8">
      <StateDisplay type="error" size="medium" message={error} />
    </div>
  {:else if !schema}
    <div class="p-8">
      <StateDisplay type="loading" size="large" message="Loading schema..." />
    </div>
  {:else}
    <!-- Split Layout: 3D Viewer + Controls -->
    <div class="flex flex-col lg:flex-row gap-6 p-6 h-[calc(100vh-120px)] bg">
      <div class="flex-1 overflow-y-auto">
        {#if schema.layout.type === "tabbed" && schema.layout.tabs && schema.layout.tabs.length > 0}
          <TabLayout
            {schema}
            bind:values
            onValueChange={handleValueChange}
            debounceSliders={false}
          />
        {:else}
          <Layout
            {schema}
            bind:values
            onValueChange={handleValueChange}
            debounceSliders={false}
          />
        {/if}
      </div>

      <!-- Left Side: 3D Viewer -->
      {#if schema.enable3dViewer}
        <div
          class="flex-1 min-h-[400px] lg:min-h-0 rounded-lg overflow-hidden shadow-lg w-40"
        >
          <canvas class="block w-full h-full" bind:this={canvas}></canvas>
        </div>
      {/if}
    </div>
  {/if}
</PageContainer>
