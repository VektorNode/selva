<script lang="ts">
  import type { PageProps } from "./$types";
  import { TabLayout, Layout } from "$lib/components/preview";
  import { PageContainer, PageHeader } from "$lib/components/layout";
  import { StateDisplay } from "$lib/components/ui";
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
  import {
    ThreeMFLoader,
    type OrbitControls,
  } from "three/examples/jsm/Addons.js";
  import { onMount } from "svelte";
  import type { ThreeInitializerOptions } from "rhino-compute-core/visualization";

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
        console.log(
          "Setting initial value for input:",
          input.name,
          input.default,
          input.id
        );
        // Key by id (GUID) to match TabLayout's expectation
        initialValues[input.id] =
          input.default ?? getDefaultValue(input.paramType);
      });

      schema.outputs.forEach((output) => {
        // Key by id (GUID) to match TabLayout's expectation
        initialValues[output.id] = null;
      });

      values = initialValues;
    }
  });

  function getDefaultValue(type: string) {
    switch (type) {
      case "number":
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
      name: input.nickname || input.name, // Use nickname for Rhino Compute mapping
      nickname: input.nickname || null,
      treeAccess: input.treeAccess || false,
      paramId: input.id, // Use id field which is the Grasshopper GUID
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

  async function handleValueChange(parameterId: string, value: any) {
    // parameterId is the GUID (input.id)
    values[parameterId] = value;

    try {
      solving = true;
      error = "";
      const inputTree = inputsToDataTrees(
        schema.inputs
          .filter((input) => input.paramType)
          .map((input) => transformInputParameter(input, values[input.id]))
      );

      console.log("Solving with inputs:", inputTree);

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

      // Map outputs by id (Grasshopper GUID) instead of name
      // This handles name/nickname collisions properly
      const mappedOutputs: Record<string, any> = {};

      // Map the compute response to our schema using the Grasshopper GUID (id field)
      Object.entries(outputValues.values).forEach(
        ([computeKey, computeValue]) => {
          // Try to find matching output by checking all possible mappings
          const matchingOutput = schema.outputs.find((output) => {
            // Match by id (Grasshopper GUID) first - most reliable
            if (output.id && computeKey === output.id) return true;
            // Fallback to name matching
            if (computeKey === output.name) return true;
            // Fallback to nickname matching
            if (computeKey === output.nickname) return true;
            return false;
          });

          if (matchingOutput) {
            // Use the output's id (GUID) as the key in our values object
            mappedOutputs[matchingOutput.id] = computeValue;
          } else {
            // If no match found, keep the original key (backward compatibility)
            mappedOutputs[computeKey] = computeValue;
          }
        }
      );

      values = { ...values, ...mappedOutputs };
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
      const option: ThreeInitializerOptions = {
        environment: { backgroundColor: "#4b5357" },
      };
      const threeSetup = initThree(canvas, option);
      scene = threeSetup.scene;
      camera = threeSetup.camera;
      controls = threeSetup.controls;
    }
  });
</script>

<PageContainer>
  <PageHeader title={schema.name} badge={badgeConfig} />

  <div class="flex-1 overflow-hidden bg-background">
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
