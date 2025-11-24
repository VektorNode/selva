<script lang="ts">
  import type { PageProps } from './$types';
  import { TabLayout } from '$lib/components/preview';
  import { PageContainer, PageHeader } from '$lib/components/layout';
  import { StateDisplay, Button } from '$lib/components/ui';
  import { onMount } from 'svelte';
  import { getDefaultValue } from '$lib/utils/session';
  import { PUBLIC_COMPUTE_SERVER_URL, PUBLIC_GH_DEFINITION } from '$env/static/public';

  let { data }: PageProps = $props();
  let schema = $state(data.schema);

  // Core state
  let values = $state<Record<string, unknown>>({});
  let solving = $state(false);
  let error = $state('');
  let viewerInitialized = $state(false);

  // Viewer refs
  let canvas: HTMLCanvasElement | null = $state(null);
  let scene: any = null;
  let camera: any = null;
  let controls: any = null;

  // Deferred imports
  let rhinoCompute: typeof import('@computebuilder/core') | null = null;
  let THREE: typeof import('three') | null = null;

  // Manual solve mode
  let pendingValues = $state<Record<string, unknown>>({});
  let hasPendingChanges = $state(false);

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
    if (!rhinoCompute) rhinoCompute = await import('@computebuilder/core');
    if (schema.enable3dViewer && !THREE) THREE = await import('three');
  }

  async function initializeViewer() {
    if (!schema.enable3dViewer || !canvas || viewerInitialized) return;

    await ensureModulesLoaded();

    const opts = {
      environment: { backgroundColor: '#4b5357' },
    };

    const { scene: s, camera: c, controls: ctl } = rhinoCompute!.initThree(canvas, opts);

    scene = s;
    camera = c;
    controls = ctl;
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
        serverUrl: PUBLIC_COMPUTE_SERVER_URL,
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

      const processor = new rhinoCompute!.GrasshopperResponseProcessor(solved);

      if (schema.enable3dViewer && scene) {
        const meshes = await processor.extractMeshesFromResponse();
        rhinoCompute!.updateScene(scene, meshes, camera, controls, viewerInitialized);
        viewerInitialized = true;
      }

      const outputs: Record<string, unknown> = {};
      for (const o of schema.outputs) {
        outputs[o.id] = processor.getValueByParamId(o.id, { parseValues: true });
      }

      console.log('Outputs:', outputs);

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

  // Badge binding
  const BADGES = {
    solving: { label: 'Solving...', variant: 'solving' } as const,
    compute: { label: 'Rhino Compute', variant: 'compute' } as const,
  };

  const badgeConfig = $derived(solving ? BADGES.solving : BADGES.compute);
  onMount(initializeViewer);
</script>

<PageContainer>
  <PageHeader title={schema.name} badge={badgeConfig} />

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
      <div class="flex h-full flex-col gap-6 overflow-hidden p-6 lg:flex-row">
        <!-- Controls -->
        <div class="w-full shrink-0 overflow-y-auto lg:w-[480px] xl:w-[520px]">
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
        {#if schema.enable3dViewer}
          <div class="min-h-[500px] flex-1 overflow-hidden rounded-lg bg-white shadow-lg">
            <canvas class="block h-full w-full" bind:this={canvas}></canvas>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</PageContainer>
