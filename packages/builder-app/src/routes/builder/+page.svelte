<script lang="ts">
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import {
    PageContainer,
    PageHeader,
    StateDisplay,
    Button,
    Dialog,
    toast,
  } from '@selva/ui-shared';
  import { Save } from '@lucide/svelte';
  import { DragDropContext, BuilderSidebar, TabEditor } from '$lib/components/builder';
  import { initializeWebSocketSession } from '$lib/utils/session';
  import { onMount } from 'svelte';
  import { useBuilderState } from '$lib/composables/useBuilderState.svelte';
  import { useBuilderActions } from '$lib/composables/useBuilderActions.svelte';

  let sessionId = $state('');
  let builderState = $state<ReturnType<typeof useBuilderState> | null>(null);
  let showBatchProcessor = $state(false);

  const actions = useBuilderActions(() => builderState);

  // Navigate to specific routes with session and wsPort preservation
  function navigateTo(route: '/' | '/preview') {
    // Auto-save schema when switching to interactive mode
    if (route === '/preview') {
      saveSchema();
    }

    const params = new URLSearchParams();
    if (sessionId) params.set('session', sessionId);
    const wsPort = page.url.searchParams.get('wsPort');
    if (wsPort) params.set('wsPort', wsPort);

    const url = `${route}?${params.toString()}`;
    goto(url);
  }

  const placedInLayoutIds = $derived.by(() => {
    const ids = new Set<string>();
    const layout = builderState?.state.schema?.layout;

    if (layout?.type === 'tabbed') {
      layout.tabs.forEach((tab) => {
        tab.groups.forEach((group) => {
          group.items.forEach((item) => {
            ids.add(item.paramId);
          });
        });
      });
    } else if (layout?.type === 'flat') {
      layout.groups.forEach((group) => {
        group.items.forEach((item) => {
          ids.add(item.paramId);
        });
      });
    }
    return ids;
  });

  const availableInputs = $derived(
    builderState?.state.availableInputs.filter((p) => !placedInLayoutIds.has(p.id)) || []
  );

  const availableOutputsUnplaced = $derived(
    builderState?.state.availableOutputs.filter((o) => !placedInLayoutIds.has(o.id)) || []
  );

  function saveSchema() {
    if (!builderState?.state.schema || !sessionId) return;
    console.log($state.snapshot(builderState.state.schema));

    if (!builderState.wsState.connected) {
      toast.error('Not connected to Grasshopper');
      return;
    }

    builderState.wsState.saveSchema(sessionId, $state.snapshot(builderState.state.schema));
  }

  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveSchema();
    }
  }

  onMount(() => {
    const urlSessionId = page.url.searchParams.get('session') || '';
    sessionId = urlSessionId;

    const initializeBuilder = async () => {
      const result = await initializeWebSocketSession(urlSessionId);

      if (result.error) {
        if (builderState) {
          builderState.state.error = result.error;
          builderState.state.loading = false;
        }
        return;
      }

      builderState = useBuilderState(urlSessionId);
      builderState.initialize();
    };

    initializeBuilder();
    window.addEventListener('keydown', handleKeydown);

    return () => {
      window.removeEventListener('keydown', handleKeydown);
      builderState?.cleanup();
    };
  });

  function getParameterInfo(paramId: string) {
    return builderState?.state.availableInputs.find((p) => p.id === paramId);
  }

  function handleTabChange(tabId: string) {
    if (builderState) {
      builderState.state.activeTabId = tabId;
    }
  }

  const badgeConfig = $derived(
    builderState?.wsState.connected
      ? { label: 'Connected', variant: 'connected' as const }
      : { label: 'Disconnected', variant: 'disconnected' as const }
  );
</script>

<DragDropContext>
  <PageContainer background="white">
    <PageHeader title="Schema Builder" {sessionId} showModeToggle={true} badge={badgeConfig}>
      <nav class="flex items-center gap-2">
        {#if builderState?.state.syncNeeded}
          <Button
            variant="default"
            size="sm"
            onclick={() => builderState?.syncParameters()}
            class="animate-pulse bg-amber-500 hover:bg-amber-600"
          >
            ⚡ Sync Parameters
          </Button>
        {/if}
        <Button variant="outline" size="sm" onclick={() => navigateTo('/')}>Home</Button>
        <Button variant="default" size="sm">Schema Builder</Button>
        <Button variant="outline" size="sm" onclick={() => navigateTo('/preview')}>
          Interactive Preview
        </Button>
        <div class="h-6 w-px bg-gray-300"></div>
        <Button
          variant="outline"
          size="sm"
          onclick={() => (showBatchProcessor = !showBatchProcessor)}
        >
          Batch Processors
        </Button>
      </nav>
    </PageHeader>

    <div class="flex-1 overflow-auto">
      {#if builderState?.state.loading}
        <div class="flex min-h-[400px] items-center justify-center">
          <StateDisplay type="loading" size="large" message="Loading schema..." />
        </div>
      {:else if builderState?.state.schema}
        <div
          class="mx-auto grid h-full max-w-[2000px] grid-cols-1 gap-6 p-6 xl:grid-cols-[400px_1fr]"
        >
          {#if builderState.state.error}
            <div class="col-span-2">
              <StateDisplay type="warning" size="medium" message={builderState.state.error} />
            </div>
          {/if}

          <BuilderSidebar
            schema={builderState.state.schema}
            {availableInputs}
            availableOutputs={availableOutputsUnplaced}
            placedIds={placedInLayoutIds}
            syncNeeded={builderState.state.syncNeeded}
            onSchemaChange={(updatedSchema) => {
              if (builderState) builderState.state.schema = updatedSchema;
            }}
            onSync={() => builderState?.syncParameters()}
            onAddToGroup={actions.onAddToGroup}
            onAddToNewGroup={actions.onAddToNewGroup}
          />

          <main class="flex flex-col gap-6">
            {#if builderState.state.schema.layout?.type === 'tabbed'}
              <TabEditor
                bind:tabs={builderState.state.schema.layout.tabs}
                activeTabId={builderState.state.activeTabId}
                onTabChange={handleTabChange}
                onAddTab={actions.onAddTab}
                onRemoveTab={actions.onRemoveTab}
                onReorderTabs={actions.onReorderTabs}
                onAddGroup={actions.onAddGroup}
                onRemoveGroup={actions.onRemoveGroup}
                onReorderGroups={actions.onReorderGroups}
                onParameterDrop={actions.onParameterDrop}
                onReorder={actions.onReorder}
                onRemoveItem={actions.onRemoveItem}
                {getParameterInfo}
              />
            {/if}

            <div class="mb-20 flex justify-end gap-4">
              <Button onclick={saveSchema}><Save class="h-4 w-4 mr-2" />Save Schema</Button>
            </div>
          </main>
        </div>
      {/if}
    </div>

    <Dialog.Root bind:open={showBatchProcessor}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Batch Processor - Number Inputs</Dialog.Title>
          <Dialog.Description>
            Convert all number/slider inputs across the entire schema in one action.
          </Dialog.Description>
        </Dialog.Header>

        <div class="space-y-3">
          <Button
            variant="default"
            class="w-full"
            onclick={() => actions.onBatchConvertToSliders(() => (showBatchProcessor = false))}
          >
            Convert All to Sliders
          </Button>
          <Button
            variant="default"
            class="w-full"
            onclick={() => actions.onBatchConvertToNumberInputs(() => (showBatchProcessor = false))}
          >
            Convert All to Number Inputs
          </Button>
        </div>

        <Dialog.Footer>
          <Button variant="outline" onclick={() => (showBatchProcessor = false)}>Close</Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  </PageContainer>
</DragDropContext>
