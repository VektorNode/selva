<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { getWebSocketState } from '$lib/websocket/websocket.svelte';
  import type { UISchema, AvailableParameters, SupportedTypes } from '$lib/types/generated';
  import { TabLayout } from '$lib/components/preview';
  import { PageContainer, PageHeader } from '$lib/components/layout';
  import { StateDisplay, Button } from '$lib/components/ui';
  import { initializeWebSocketSession, ensureSchemaLayoutDefaults } from '$lib/utils/session';
  import { onMount } from 'svelte';
  import { computeCombinedBoundingBox, type MeshBatch } from '@selva/core';
  import {
    ensureRhinoComputeLoaded as loadRhinoCompute,
    initializeViewerScene,
    updateViewerScene,
    processMeshBatches,
    applyMeshTransforms,
    type ViewerState,
  } from '$lib/features/preview/viewer';
  import {
    initializeValues,
    processOutputUpdate,
    updateParameterMetadata,
    removeParametersFromValues,
  } from '$lib/features/preview/handlers';
  import {
    formatParameterUpdateMessage,
    formatMetadataUpdateMessage,
  } from '$lib/features/preview/notifications';

  type RuntimeMode = 'local' | 'compute';

  let sessionId = $state('');
  let schema = $state<UISchema | null>(null);
  let values = $state<Record<string, unknown>>({});
  let loading = $state(true);
  let error = $state('');
  let canvas: HTMLCanvasElement | null = $state(null);

  const wsState = getWebSocketState();

  let schemaUpdateNotification = $state('');
  let notificationTimer: ReturnType<typeof setTimeout> | null = null;

  let runtimeMode = $state<RuntimeMode>('local');
  let solving = $state(false);
  let syncNeeded = $state(false);

  let displayMeshes = $state<any[]>([]);
  let viewerState = $state<ViewerState>({
    scene: null,
    camera: null,
    controls: null,
    initialized: false,
  });
  let modelUnits = $state<string>('Meters');

  let rhinoCompute: typeof import('@selva/core') | null = null;

  let isRemoteUpdate = $state(false);
  let pendingValues = $state<Record<string, unknown>>({});
  let hasPendingChanges = $state(false);

  function showNotification(message: string, duration: number = 3000) {
    schemaUpdateNotification = message;
    if (notificationTimer) {
      clearTimeout(notificationTimer);
    }
    notificationTimer = setTimeout(() => {
      schemaUpdateNotification = '';
      notificationTimer = null;
    }, duration);
  }

  async function ensureViewerModuleLoaded() {
    if (!rhinoCompute) {
      rhinoCompute = await loadRhinoCompute();
    }
  }

  async function initializeViewer() {
    if (!canvas || viewerState.initialized) return;

    await ensureViewerModuleLoaded();

    const state = await initializeViewerScene(canvas, rhinoCompute!);
    viewerState = state;
  }

  async function updateViewer() {
    if (!viewerState.initialized || displayMeshes.length === 0) return;
    await ensureViewerModuleLoaded();
    await updateViewerScene(rhinoCompute!, viewerState, displayMeshes);
  }

  $effect(() => {
    if (displayMeshes.length > 0) {
      if (!viewerState.initialized && canvas) {
        initializeViewer().then(() => updateViewer());
      } else if (viewerState.initialized) {
        updateViewer();
      }
    }
  });

  async function handleValueChange(paramId: string, value: SupportedTypes) {
    if (isRemoteUpdate) {
      console.log('[Preview] Skipping send for remote update on paramId:', paramId);
      return;
    }

    values[paramId] = value;

    if (schema?.instanceSolve === false) {
      pendingValues[paramId] = value;
      hasPendingChanges = true;
      return;
    }

    if (runtimeMode === 'local' && wsState.connected) {
      wsState.sendValueUpdate(sessionId, $state.snapshot(values));
    } else if (!wsState.connected) {
      console.warn('[Preview] Cannot send values - WebSocket not connected');
    }
  }

  function handleCalculate() {
    if (!hasPendingChanges) return;
    if (runtimeMode === 'local' && wsState.connected) {
      wsState.sendValueUpdate(sessionId, $state.snapshot(values));
      pendingValues = {};
      hasPendingChanges = false;
    } else if (!wsState.connected) {
    }
  }

  function navigateTo(route: '/' | '/builder') {
    const url = route === '/' ? `/?session=${sessionId}` : `/builder?session=${sessionId}`;
    goto(url);
  }

  function syncParameters() {
    syncNeeded = false;
    wsState.requestInitialData(sessionId);
    showNotification('Syncing parameters...');
  }

  const badgeConfig = $derived(
    runtimeMode === 'local'
      ? wsState.connected
        ? { label: 'Connected', variant: 'connected' as const }
        : {
            label: 'Disconnected',
            variant: 'disconnected' as const,
          }
      : solving
        ? { label: '⚙️ Solving...', variant: 'solving' as const }
        : { label: '☁️ Rhino Compute', variant: 'compute' as const }
  );

  onMount(() => {
    const handleInitialData = (message: any) => {
      if (message.sessionId === sessionId) {
        console.log('[Preview] Received initial data:', message);

        const receivedSchema = message.schema;
        const availableParams = message.availableParams as AvailableParameters;

        if (!receivedSchema) {
          error = 'No schema configured. Please use the Schema Builder to create a UI.';
          loading = false;
          return;
        }

        const processedSchema = ensureSchemaLayoutDefaults(receivedSchema);
        if (!processedSchema) {
          error = 'Failed to process schema.';
          loading = false;
          return;
        }

        const newValues = initializeValues({
          schema: processedSchema,
          availableParams,
          currentValues: message.currentValues,
        });

        isRemoteUpdate = true;
        values = newValues;
        isRemoteUpdate = false;

        schema = processedSchema;
        loading = false;
      }
    };

    const handleCurrentValues = (message: any) => {
      if (message.sessionId === sessionId) {
        console.log('[Preview] Received current values:', message.values);
        isRemoteUpdate = true;
        values = { ...values, ...message.values };
        isRemoteUpdate = false;
      }
    };

    const handleOutputs = async (message: any) => {
      if (message.sessionId === sessionId) {
        if (message.modelUnits) {
          modelUnits = message.modelUnits;
        }

        if (message.displayData) {
          try {
            const dataArray = Array.isArray(message.displayData)
              ? message.displayData
              : [message.displayData];

            const allMeshes = await processMeshBatches(dataArray as MeshBatch[], modelUnits);
            await applyMeshTransforms(allMeshes);

            displayMeshes = allMeshes;
          } catch (err) {
            console.error('[Preview] Error parsing display data:', err);
          }
        }

        const allUpdates = processOutputUpdate({
          outputs: message.outputs,
          fileOutputs: message.fileOutputs,
          schema,
        });

        if (Object.keys(allUpdates).length > 0) {
          isRemoteUpdate = true;
          values = { ...values, ...allUpdates };
          isRemoteUpdate = false;
        }
      }
    };

    const handleOutputUpdate = (message: any) => {
      if (message.sessionId === sessionId) {
        const allUpdates = processOutputUpdate({
          outputs: message.outputs,
          schema,
        });

        if (Object.keys(allUpdates).length > 0) {
          isRemoteUpdate = true;
          values = { ...values, ...allUpdates };
          isRemoteUpdate = false;
        }
      }
    };

    const handleSchemaUpdated = (message: any) => {
      if (message.sessionId === sessionId) {
        const removedCount = message.removedIds?.length || 0;
        const newSchema = ensureSchemaLayoutDefaults(JSON.parse(JSON.stringify(message.schema)));

        if (message.removedIds && message.removedIds.length > 0) {
          values = removeParametersFromValues(values, message.removedIds);
        }

        schema = null;
        setTimeout(() => {
          schema = newSchema;
          if (removedCount > 0) {
            const msg = formatParameterUpdateMessage(removedCount);
            showNotification(msg);
          }
        }, 10);
      }
    };

    const handleMetadataUpdated = (message: any) => {
      if (message.sessionId === sessionId && schema) {
        const changedParams = message.changedParams || [];
        if (changedParams.length === 0) return;

        const result = updateParameterMetadata(schema, changedParams);

        if (result.updated > 0) {
          const msg = formatMetadataUpdateMessage(result.names);
          showNotification(msg);
        }
      }
    };

    const handleParametersAdded = (message: any) => {
      if (message.sessionId === sessionId) {
        syncNeeded = true;
        showNotification('New parameters detected - click Sync to add them to your UI');
      }
    };

    const initializeSchema = async () => {
      sessionId = page.url.searchParams.get('session') || '';

      if (runtimeMode === 'local') {
        const result = await initializeWebSocketSession(sessionId);

        if (result.error) {
          error = result.error;
          loading = false;
          return;
        }

        wsState.on('initialData', handleInitialData);
        wsState.on('currentValues', handleCurrentValues);
        wsState.on('outputs', handleOutputs);
        wsState.on('outputUpdate', handleOutputUpdate);
        wsState.on('schemaUpdated', handleSchemaUpdated);
        wsState.on('metadataUpdated', handleMetadataUpdated);
        wsState.on('parametersAdded', handleParametersAdded);

        console.log('[Preview] Requesting initial data from Grasshopper');
        wsState.requestInitialData(sessionId);
      }
    };

    initializeSchema();

    return () => {
      wsState.off('initialData', handleInitialData);
      wsState.off('currentValues', handleCurrentValues);
      wsState.off('outputs', handleOutputs);
      wsState.off('outputUpdate', handleOutputUpdate);
      wsState.off('schemaUpdated', handleSchemaUpdated);
      wsState.off('metadataUpdated', handleMetadataUpdated);
      wsState.off('parametersAdded', handleParametersAdded);
    };
  });
</script>

<PageContainer background="white">
  <PageHeader
    title={schema?.name || 'Interactive Preview'}
    badge={badgeConfig}
    showModeToggle={true}
    {sessionId}
  >
    <nav class="flex items-center gap-2">
      {#if syncNeeded}
        <Button
          variant="default"
          size="sm"
          onclick={syncParameters}
          class="animate-pulse bg-amber-500 hover:bg-amber-600"
        >
          ⚡ Sync Parameters
        </Button>
      {/if}
      <Button variant="outline" size="sm" onclick={() => navigateTo('/')}>Home</Button>
      <Button variant="outline" size="sm" onclick={() => navigateTo('/builder')}>
        Schema Builder
      </Button>
      <Button variant="default" size="sm">Interactive Preview</Button>
    </nav>
  </PageHeader>

  <div class="relative flex-1 overflow-auto">
    {#if loading}
      <div class="flex min-h-[400px] items-center justify-center">
        <StateDisplay type="loading" size="large" message="Loading preview..." />
      </div>
    {:else if error}
      <div class="flex min-h-[400px] items-center justify-center">
        <StateDisplay type="error" size="large" message={error} />
      </div>
    {:else if schema}
      <div class="flex h-full flex-col gap-6 overflow-hidden p-6 lg:flex-row">
        <!-- Controls -->
        <div
          class="w-full shrink-0 overflow-y-auto {displayMeshes.length > 0
            ? 'lg:w-[480px] xl:w-[520px]'
            : 'mx-auto max-w-6xl'}"
        >
          {#if schema.layout.type === 'tabbed' && schema.layout.tabs && schema.layout.tabs.length > 0}
            <TabLayout
              {schema}
              bind:values
              onValueChange={handleValueChange}
              debounceSliders={true}
            />
          {/if}

          {#if schema.instanceSolve === false}
            <div class="sticky bottom-0 mt-6 flex justify-center">
              <Button
                variant={hasPendingChanges ? 'default' : 'outline'}
                size="lg"
                onclick={handleCalculate}
                disabled={!hasPendingChanges || wsState.isSolving}
                class="shadow-lg"
              >
                {#if wsState.isSolving}
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

        <!-- 3D Viewer (conditional) -->
        {#if displayMeshes.length > 0}
          <div class="min-h-[500px] flex-1 overflow-hidden rounded-lg bg-white shadow-lg">
            <canvas class="block h-full w-full" bind:this={canvas}></canvas>
          </div>
        {/if}
      </div>

      {#if wsState.isSolving}
        <div
          class="fixed bottom-8 left-8 z-50 flex animate-[slideInLeft_0.3s_ease-out] items-center gap-3 rounded-lg bg-primary px-4 py-3 text-primary-foreground shadow-lg"
        >
          <div
            class="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent"
          ></div>
          <span class="text-sm font-medium">Solving...</span>
        </div>
      {/if}
    {/if}
  </div>

  {#if schemaUpdateNotification}
    <div
      class="fixed right-8 bottom-8 z-50 flex animate-[slideInRight_0.3s_ease-out] items-center gap-3 rounded-lg bg-blue-600 px-6 py-4 text-white shadow-lg"
    >
      <svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      <span class="font-medium">{schemaUpdateNotification}</span>
    </div>
  {/if}
</PageContainer>

<style>
  @keyframes slideInRight {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }

  @keyframes slideInLeft {
    from {
      transform: translateX(-100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
</style>
