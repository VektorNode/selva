<script lang="ts">
  import type { PageProps } from './$types';
  import { TabLayout } from '$lib/components/preview';
  import { PageContainer, PageHeader } from '$lib/components/layout';
  import { StateDisplay, Button } from '$lib/components/ui';
  import { Maximize, Minimize } from '@lucide/svelte';
  import { getDefaultValue } from '$lib/utils/session';
  import { PUBLIC_COMPUTE_SERVER_URL, PUBLIC_GH_DEFINITION } from '$env/static/public';

  let { data }: PageProps = $props();
  let schema = $derived(data.schema);

  // Core state
  let values = $state<Record<string, unknown>>({});
  let solving = $state(false);
  let error = $state('');
  let viewerInitialized = $state(false);

  // Viewer refs
  let canvas: HTMLCanvasElement | null = $state(null);
  let scene = $state<unknown | null>(null);
  let camera = $state<unknown | null>(null);
  let controls = $state<unknown | null>(null);

  // Deferred imports
  let rhinoCompute: typeof import('@selva/core') | null = null;

  // Manual solve mode
  let pendingValues = $state<Record<string, unknown>>({});
  let hasPendingChanges = $state(false);
  let isViewerFullscreen = $state(false);

  // -----------------------------
  // Initialization
  // -----------------------------
  function initializeValues() {
    if (!schema) return;

    const v: Record<string, unknown> = {};

    for (const input of schema.inputs) {
      v[input.id] = input.default ?? getDefaultValue(input.paramType);
    }
    for (const output of schema.outputs) {
      v[output.id] = null;
    }

    values = v;
  }

  $effect(() => initializeValues());

  // -----------------------------
  // Rhino Compute utilities
  // -----------------------------
  async function ensureModulesLoaded() {
    if (!rhinoCompute) rhinoCompute = await import('@selva/core');
  }

  // Check if viewer should be shown (either enableLocal or enableRemote)
  const shouldShowViewer = $derived(
    schema?.viewerOptions?.enableLocal || schema?.viewerOptions?.enableRemote
  );

  async function initializeViewer() {
    if (!shouldShowViewer || !canvas || scene) return;

    await ensureModulesLoaded();

    const opts = {
      environment: { backgroundColor: schema?.viewerOptions?.backgroundColor ?? '#E6E6E6' },
    };

    const { scene: s, camera: c, controls: ctl } = rhinoCompute!.initThree(canvas, opts);

    scene = s;
    camera = c;
    controls = ctl;

    viewerInitialized = true;
  }

  // -----------------------------
  // Solve logic
  // -----------------------------
  async function performSolve() {
    try {
      solving = true;
      error = '';

      await ensureModulesLoaded();

      const payload = {
        inputs: schema.inputs,
        values: $state.snapshot(values),
        definitionUrl: PUBLIC_GH_DEFINITION,
      };

      const res = await fetch('/api/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.message || 'Compute error');
      }

      const solved = await res.json();

      console.log('Compute response:', solved);

      const processor = new rhinoCompute!.GrasshopperResponseProcessor(solved, false);

      if (shouldShowViewer) {
        const meshes = await processor.extractMeshesFromResponse();

        // Initialize viewer on first mesh render
        if (!scene && meshes.length > 0) {
          await initializeViewer();
        }

        // Update scene if viewer is initialized
        if (scene && meshes.length > 0) {
          rhinoCompute!.updateScene(
            scene as any,
            meshes,
            camera as any,
            controls as any,
            viewerInitialized
          );
          viewerInitialized = true;
        }
      }

      const outputs: Record<string, unknown> = {};
      for (const o of schema.outputs) {
        outputs[o.id] = processor.getValueByParamId(o.id, { parseValues: true });
      }

      values = { ...values, ...outputs };
      pendingValues = {};
      hasPendingChanges = false;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    } finally {
      solving = false;
    }
  }

  // -----------------------------
  // Handlers
  // -----------------------------
  async function handleValueChange(id: string, val: unknown) {
    values[id] = val;

    if (schema?.instanceSolve === false) {
      pendingValues[id] = val;
      hasPendingChanges = true;
      return;
    }

    await performSolve();
  }

  function handleCalculate() {
    if (hasPendingChanges) performSolve();
  }

  function toggleFullscreen() {
    isViewerFullscreen = !isViewerFullscreen;
  }

  const BADGES = {
    solving: { label: 'Solving...', variant: 'solving' } as const,
    compute: { label: 'Rhino Compute', variant: 'compute' } as const,
  };

  const badgeConfig = $derived(solving ? BADGES.solving : BADGES.compute);
</script>

<PageContainer>
  <PageHeader title={schema.name} badge={badgeConfig} showModeToggle={true} showThemeSwitcher />

  <div class="flex-1 overflow-hidden bg-background">
    {#if error}
      <div class="flex min-h-[400px] items-center justify-center p-8">
        <StateDisplay type="error" size="medium" message={error} />
      </div>
    {:else if !schema}
      <div class="flex min-h-[400px] items-center justify-center">
        <StateDisplay type="loading" size="large" message="Loading schema..." />
      </div>
    {:else}
      <div
        class="flex h-full flex-col gap-6 overflow-hidden p-6 lg:flex-row {isViewerFullscreen
          ? 'fullscreen-container'
          : ''}"
      >
        <!-- Controls -->
        <div
          class="w-full shrink-0 overflow-y-auto lg:w-[480px] xl:w-[520px] {isViewerFullscreen
            ? 'hidden'
            : ''}"
        >
          {#if schema.layout.type === 'tabbed'}
            <TabLayout
              {schema}
              bind:values
              onValueChange={handleValueChange}
              debounceSliders={false}
            />
          {/if}

          {#if schema.instanceSolve === false}
            <div class="sticky bottom-0 mt-6 flex justify-center">
              <Button
                variant={hasPendingChanges ? 'default' : 'outline'}
                size="lg"
                onclick={handleCalculate}
                disabled={!hasPendingChanges || solving}
                class="shadow-lg"
              >
                {#if solving}
                  <div
                    class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-background border-t-transparent"
                  ></div>
                  Solving...
                {:else if hasPendingChanges}
                  Calculate
                {:else}
                  No Changes
                {/if}
              </Button>
            </div>
          {/if}
        </div>

        <!-- Viewer -->
        {#if shouldShowViewer}
          <div
            class="relative min-h-[500px] flex-1 rounded-lg bg-white shadow-lg {isViewerFullscreen
              ? 'fullscreen-viewer'
              : ''}"
          >
            <div class="absolute inset-0">
              <canvas class="block h-full w-full rounded-lg" bind:this={canvas}></canvas>
            </div>
            <!-- Fullscreen Toggle Button -->
            <button
              class="absolute right-4 bottom-4 z-50 flex h-10 w-10 items-center justify-center rounded-lg bg-white/90 shadow-lg transition-all hover:bg-white hover:shadow-xl active:scale-95"
              onclick={toggleFullscreen}
              title={isViewerFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              {#if isViewerFullscreen}
                <Minimize class="h-5 w-5 text-gray-700" />
              {:else}
                <Maximize class="h-5 w-5 text-gray-700" />
              {/if}
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</PageContainer>

<style>
  .fullscreen-container {
    position: fixed;
    inset: 0;
    z-index: 9999;
    padding: 0 !important;
    background: white;
  }

  .fullscreen-viewer {
    position: fixed;
    inset: 0;
    z-index: 10000;
    border-radius: 0 !important;
    min-height: 100vh;
    width: 100vw;
  }
</style>
