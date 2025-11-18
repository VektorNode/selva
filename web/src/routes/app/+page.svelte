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
    type InputParam,
    initThree,
    updateScene,
  } from "rhino-compute-core";
  import type { InputParamSchema } from "$lib/types/schema";
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

  $effect(() => {
    if (schema) {
      const initialValues: Record<string, any> = {};

      schema.inputs.forEach((input) => {
        initialValues[input.name] =
          input.default ?? getDefaultValue(input.paramType);
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
    input: InputParamSchema,
    value: any
  ): InputParam {
    const base = {
      description: input.description || "",
      name: input.name,
      nickname: input.nickname || null,
      treeAccess: input.treeAccess || false,
    };

    if (input.paramType === "Number" || input.paramType === "Integer") {
      return {
        ...base,
        paramType: input.paramType as "Number" | "Integer",
        minimum: input.minimum,
        maximum: input.maximum,
        atLeast: input.atLeast,
        atMost: input.atMost,
        stepSize: input.paramType === "Integer" ? 1 : input.stepSize,
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
    }

    return {
      ...base,
      paramType: "Text",
      default: value ?? "",
    } as TextInputType;
  }

  async function handleValueChange(parameterName: string, value: any) {
    values[parameterName] = value;

    try {
      solving = true;
      error = "";
      const inputTree = inputsToDataTrees(
        schema.inputs
          .filter((input) => input.paramType)
          .map((input) => transformInputParameter(input, values[input.name]))
      );

      const solvedDefinition = await solveGrasshopperDefinition(
        inputTree,
        "http://localhost:5173/builder_test.gh",
        { serverUrl: "http://localhost:5000/" }
      );

      const processor = new GrasshopperResponseProcessor(solvedDefinition);
      const outputValues = processor.getValues();

      if (schema.enable3dViewer && scene) {
        const meshes = processor.extractMeshesFromResponse();
        updateScene(scene, meshes, camera, controls, viewerInitialized);
        viewerInitialized = true;
      }

      //TODO: Outputs dont get mapped properly (neeeds fixing also at the c# side ) eg. in compute numberOutput: 155 in c#  fgdf (nickname/displayname/name collisione )

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
  <PageHeader title={schema.name} badge={badgeConfig} />

  <div class="flex-1 overflow-hidden bg-gray-50">
    {#if error}
      <div class="flex items-center justify-center min-h-[400px] p-8">
        <StateDisplay type="error" size="medium" message={error} />
      </div>
    {:else if !schema}
      <div class="flex items-center justify-center min-h-[400px]">
        <StateDisplay type="loading" size="large" message="Loading schema..." />
      </div>
    {:else}
      <div class="flex flex-col lg:flex-row gap-6 p-6 h-full overflow-hidden">
        <div class="w-full lg:w-[480px] xl:w-[520px] overflow-y-auto shrink-0">
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

        {#if schema.enable3dViewer}
          <div
            class="flex-1 rounded-lg overflow-hidden shadow-lg bg-white min-h-[500px]"
          >
            <canvas class="block w-full h-full" bind:this={canvas}></canvas>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</PageContainer>
