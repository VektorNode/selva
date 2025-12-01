<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { getWebSocketState } from '$lib/websocket/websocket.svelte';
  import type { UISchema, AvailableParameters, SupportedTypes } from '$lib/types/generated';
  import { TabLayout } from '$lib/components/preview';
  import { PageContainer, PageHeader } from '$lib/components/layout';
  import { StateDisplay, Button } from '$lib/components/ui';
  import {
    initializeWebSocketSession,
    ensureSchemaLayoutDefaults,
    getDefaultValue,
  } from '$lib/utils/session';
  import { onMount } from 'svelte';

  type RuntimeMode = 'local' | 'compute';

  let sessionId = $state('');
  let schema = $state<UISchema | null>(null);
  // Values stored by GUID (stable across parameter name changes)
  let values = $state<Record<string, unknown>>({});
  let loading = $state(true);
  let error = $state('');

  const wsState = getWebSocketState();

  let schemaUpdateNotification = $state('');
  let notificationTimer: ReturnType<typeof setTimeout> | null = null;

  let runtimeMode = $state<RuntimeMode>('local');
  let solving = $state(false);
  let syncNeeded = $state(false);

  // Navigate to specific routes with session preservation
  function navigateTo(route: '/' | '/builder') {
    const url = route === '/' ? `/?session=${sessionId}` : `/builder?session=${sessionId}`;
    goto(url);
  }

  function syncParameters() {
    console.log('[Preview] Syncing parameters from Grasshopper');
    syncNeeded = false;
    wsState.requestInitialData(sessionId);
    showNotification('Syncing parameters...');
  }

  // Track if we're updating values from remote (to avoid feedback loop)
  let isRemoteUpdate = $state(false);

  // Manual solve mode: track pending changes
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

  /**
   * Handle value changes from UI
   * Only send to Grasshopper if change came from user (not from remote)
   */
  async function handleValueChange(paramId: string, value: SupportedTypes) {
    if (isRemoteUpdate) {
      console.log('[Preview] Skipping send for remote update on paramId:', paramId);
      return;
    }

    // Update local values (using GUID as key)
    values[paramId] = value;

    // If instanceSolve is false, track pending changes instead of sending immediately
    if (schema?.instanceSolve === false) {
      pendingValues[paramId] = value;
      hasPendingChanges = true;
      return;
    }

    // Instance solve mode: send immediately
    if (runtimeMode === 'local' && wsState.connected) {
      console.log('[Preview] Sending value update to Grasshopper (GUID keys):', {
        [paramId]: value,
      });

      // Send via WebSocket with GUID keys (what C# expects)
      wsState.sendValueUpdate(sessionId, $state.snapshot(values));
    } else if (!wsState.connected) {
      console.warn('[Preview] Cannot send values - WebSocket not connected');
    }
  }

  /**
   * Manual solve: send all pending changes to Grasshopper
   */
  function handleCalculate() {
    if (!hasPendingChanges) return;

    if (runtimeMode === 'local' && wsState.connected) {
      console.log('[Preview] Sending pending values to Grasshopper:', pendingValues);
      wsState.sendValueUpdate(sessionId, $state.snapshot(values));
      pendingValues = {};
      hasPendingChanges = false;
    } else if (!wsState.connected) {
      console.warn('[Preview] Cannot calculate - WebSocket not connected');
    }
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
        const currentValues = message.currentValues || {};

        console.log('[Preview] Available Parameters:', availableParams);

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

        // Initialize values from available params defaults
        processedSchema.inputs.forEach((input: any) => {
          const availableParam = availableParams?.parameters?.find((p) => p.id === input.id);
          const defaultValue =
            availableParam?.default !== null && availableParam?.default !== undefined
              ? availableParam.default
              : getDefaultValue(input.paramType);

          values[input.id] = defaultValue;
        });

        processedSchema.outputs.forEach((output: any) => {
          values[output.id] = null;
        });

        // Apply current values from Grasshopper
        if (currentValues && Object.keys(currentValues).length > 0) {
          isRemoteUpdate = true;
          values = { ...values, ...currentValues };
          isRemoteUpdate = false;
        }

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

    const handleOutputs = (message: any) => {
      if (message.sessionId === sessionId) {
        console.log('[Preview] Received outputs:', message.outputs);
        console.log('[Preview] Received file outputs:', message.fileOutputs);

        // Handle regular outputs
        const outputUpdates = Object.fromEntries(
          Object.entries(message.outputs || {}).filter(([paramId]) =>
            schema?.outputs.some((o) => o.id === paramId)
          )
        );

        // Handle file outputs from downloading.components
        const fileOutputUpdates = message.fileOutputs || {};

        // Combine all updates
        const allUpdates = { ...outputUpdates, ...fileOutputUpdates };

        if (Object.keys(allUpdates).length > 0) {
          isRemoteUpdate = true;
          values = { ...values, ...allUpdates };
          isRemoteUpdate = false;
        }
      }
    };

    const handleOutputUpdate = (message: any) => {
      if (message.sessionId === sessionId) {
        console.log('[Preview] Received output update:', message.outputs);
        const outputUpdates = Object.fromEntries(
          Object.entries(message.outputs).filter(([paramId]) =>
            schema?.outputs.some((o) => o.id === paramId)
          )
        );

        if (Object.keys(outputUpdates).length > 0) {
          isRemoteUpdate = true;
          values = { ...values, ...outputUpdates };
          isRemoteUpdate = false;
        }
      }
    };

    const handleSchemaUpdated = (message: any) => {
      if (message.sessionId === sessionId) {
        console.log('[Preview] Schema updated:', {
          schema: message.schema,
          removedIds: message.removedIds,
        });

        const removedCount = message.removedIds?.length || 0;

        const newSchema = ensureSchemaLayoutDefaults(JSON.parse(JSON.stringify(message.schema)));

        if (message.removedIds && message.removedIds.length > 0) {
          const newValues = { ...values };
          message.removedIds.forEach((id: string) => {
            delete newValues[id];
          });
          values = newValues;

          console.log(`[Preview] Removed ${message.removedIds.length} parameter(s) from UI`);
        }

        schema = null;

        setTimeout(() => {
          schema = newSchema;

          if (removedCount > 0) {
            showNotification(
              `Schema updated: ${removedCount} parameter${removedCount > 1 ? 's' : ''} removed`
            );
          }
        }, 10);
      }
    };

    const handleMetadataUpdated = (message: any) => {
      if (message.sessionId === sessionId && schema) {
        console.log('[Preview] Parameter metadata updated:', message.changedParams);

        const changedParams = message.changedParams || [];
        if (changedParams.length === 0) return;

        let updatedCount = 0;
        const updatedNames: string[] = [];

        // Update input parameters with new metadata
        changedParams.forEach((updated: any) => {
          const inputIndex = schema!.inputs.findIndex((inp) => inp.id === updated.id);
          if (inputIndex !== -1) {
            const input = schema!.inputs[inputIndex];
            let changed = false;

            if (updated.nickname !== undefined && input.nickname !== updated.nickname) {
              input.nickname = updated.nickname;
              changed = true;
            }
            if (updated.description !== undefined && input.description !== updated.description) {
              input.description = updated.description;
              changed = true;
            }

            if (changed) {
              updatedCount++;
              updatedNames.push(input.nickname);
              console.log(`[Preview] Updated input metadata: ${input.nickname}`);
            }

            // Update layout item configurations (min/max/stepSize for number widgets)
            if (schema!.layout.tabs) {
              schema!.layout.tabs.forEach((tab) => {
                tab.groups?.forEach((group) => {
                  group.items?.forEach((layoutItem: any) => {
                    if (layoutItem.paramId === updated.id && layoutItem.type === 'input') {
                      const config = layoutItem.config || {};

                      if (updated.minimum !== undefined && config.minimum !== updated.minimum) {
                        config.minimum = updated.minimum;
                        changed = true;
                      }
                      if (updated.maximum !== undefined && config.maximum !== updated.maximum) {
                        config.maximum = updated.maximum;
                        changed = true;
                      }
                      if (updated.stepSize !== undefined && config.stepSize !== updated.stepSize) {
                        config.stepSize = updated.stepSize;
                        changed = true;
                      }

                      layoutItem.config = config;
                    }
                  });
                });
              });
            }
          }

          // Update output parameters with new metadata
          const outputIndex = schema!.outputs.findIndex((out) => out.id === updated.id);
          if (outputIndex !== -1) {
            const output = schema!.outputs[outputIndex];
            let changed = false;

            if (updated.nickname !== undefined && output.nickname !== updated.nickname) {
              output.nickname = updated.nickname;
              changed = true;
            }
            if (updated.description !== undefined && output.description !== updated.description) {
              output.description = updated.description;
              changed = true;
            }

            if (changed) {
              updatedCount++;
              updatedNames.push(output.nickname);
              console.log(`[Preview] Updated output metadata: ${output.nickname}`);
            }
          }
        });

        // Trigger reactivity by reassigning schema
        if (updatedCount > 0) {
          schema = schema;

          // Show notification with count
          showNotification(
            `Parameter${updatedCount > 1 ? 's' : ''} updated: ${updatedNames.join(', ')}`
          );
        }
      }
    };

    const handleParametersAdded = (message: any) => {
      if (message.sessionId === sessionId) {
        console.log('[Preview] New parameters added to Grasshopper:', message.availableParams);

        // Mark that sync is needed to pick up the new parameters
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

        // Register handlers
        wsState.on('initialData', handleInitialData);
        wsState.on('currentValues', handleCurrentValues);
        wsState.on('outputs', handleOutputs);
        wsState.on('outputUpdate', handleOutputUpdate);
        wsState.on('schemaUpdated', handleSchemaUpdated);
        wsState.on('metadataUpdated', handleMetadataUpdated);
        wsState.on('parametersAdded', handleParametersAdded);

        // Request initial data from Grasshopper
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
      // Don't disconnect - keep connection alive for page switching
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
      <div class="mx-auto max-w-6xl p-8">
        {#if schema.layout.type === 'tabbed' && schema.layout.tabs && schema.layout.tabs.length > 0}
          <TabLayout
            {schema}
            bind:values
            onValueChange={handleValueChange}
            debounceSliders={true}
          />
        {/if}

        {#if schema.instanceSolve === false}
          <div class="sticky bottom-8 mt-8 flex justify-center">
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
