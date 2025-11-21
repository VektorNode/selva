<script lang="ts">
  import MessageOverlay from "$lib/components/MessageOverlay.svelte";
  import Button from "$lib/components/Button.svelte";
  import { InputHandler, LoadingScreen } from "rhino-compute-ui";
  import {
    GrasshopperResponseProcessor,
    type DataTree,
    type GrasshopperComputeResponse,
  } from "rhino-compute-core/grasshopper";
  import {
    getThreeMeshesFromComputeResponse,
    initThree,
    updateScene,
  } from "rhino-compute-core/visualization";
  import { onMount } from "svelte";
  import * as THREE from "three";
  import type { OrbitControls } from "three/examples/jsm/Addons.js";

  // Props
  let { data } = $props();

  // Three.js state
  let scene: THREE.Scene | null = $state(null);
  let canvas: HTMLCanvasElement | null = $state(null);
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;
  let viewerInitialized = $state(false);

  // Compute state
  let isComputing = $state(false);
  let currentTree: DataTree[] = $state([]);

  // Message state
  let messages = $state({
    error: null as string | null,
    warnings: [] as string[],
    computeErrors: [] as string[],
    show: true,
  });

  // Derived state
  const hasInputs = $derived(
    data.ghInOutputs?.inputs &&
      Array.isArray(data.ghInOutputs.inputs) &&
      data.ghInOutputs.inputs.length > 0,
  );

  // Event handlers
  function handleInputChange(tree: DataTree[]) {
    currentTree = tree;
  }

  function resetMessages() {
    messages.error = null;
    messages.warnings = [];
    messages.computeErrors = [];
  }

  function handleApiError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async function handleCompute() {
    if (isComputing) {
      console.log("[CLIENT] Computation already in progress, skipping...");
      return;
    }

    isComputing = true;
    resetMessages();

    // Give the browser a chance to render the loading screen
    await new Promise((resolve) => setTimeout(resolve, 0));

    try {
      const response = await fetch("/api/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tree: currentTree }),
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.statusText}`);
      }

      const result = (await response.json()) as GrasshopperComputeResponse;

      // Handle compute errors and warnings
      if (result) {
        messages.computeErrors = Array.isArray(result.errors)
          ? result.errors
          : [];
        messages.warnings = Array.isArray(result.warnings)
          ? result.warnings
          : [];
      }

      const processor = new GrasshopperResponseProcessor(result);
      const values = processor.getValues();

      // Update 3D scene
      if (result && scene) {
        const meshes = getThreeMeshesFromComputeResponse(result);
        updateScene(scene, meshes, camera, controls, viewerInitialized);
        viewerInitialized = true;
      }
    } catch (err) {
      console.error("Error during compute:", err);
      messages.error = handleApiError(err);
    } finally {
      isComputing = false;
    }
  }

  // Initialize Three.js scene
  onMount(async () => {
    if (canvas) {
      const threeSetup = initThree(canvas);
      scene = threeSetup.scene;
      camera = threeSetup.camera;
      controls = threeSetup.controls;

      // Auto-compute if no inputs
      if (!hasInputs) {
        await handleCompute();
      }
    }
  });
</script>

<svelte:head>
  <title>Rhino Compute Example</title>
</svelte:head>

<div class="flex h-screen w-screen">
  {#if hasInputs}
    <aside
      class="flex h-full w-80 shrink-0 flex-col overflow-hidden border-r bg-gray-50 p-4"
    >
      <InputHandler
        input={data.ghInOutputs.inputs}
        onChange={handleInputChange}
        headerText="Grasshopper Inputs"
        autoUpdate={true}
        displayOptions={{
          showSliders: true,
          showRangeIndicator: false,
          accordionSeparated: true,
          darkMode: false,
          variant: "outlined",
          preset: "modern",
        }}
      >
        <Button fullWidth onclick={handleCompute}>Compute</Button>
      </InputHandler>

      {#if isComputing}
        <div
          class="mt-2 rounded bg-blue-50 p-2 text-center text-sm text-blue-700"
        >
          Computing...
        </div>
      {/if}
    </aside>
  {/if}

  <LoadingScreen
    isVisible={isComputing}
    message="Computing your Grasshopper definition..."
    backdrop="blur"
    spinnerSize="large"
  />
  <main class="relative h-full flex-1">
    <canvas
      class="pointer-events-auto block h-full w-full rounded-xl"
      bind:this={canvas}
    ></canvas>

    <MessageOverlay
      errorMessage={messages.error}
      warnings={messages.warnings}
      computeErrors={messages.computeErrors}
      showMessages={messages.show}
      onShowMessagesToggle={(show) => (messages.show = show)}
      onDismissMessage={(type, index) => {
        if (type === "error") messages.error = null;
        else if (type === "warning" && index !== undefined)
          messages.warnings.splice(index, 1);
        else if (type === "computeError" && index !== undefined)
          messages.computeErrors.splice(index, 1);
      }}
      onClearAllMessages={resetMessages}
    />
  </main>
</div>
