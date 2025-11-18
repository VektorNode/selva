<script lang="ts">
  import { page } from "$app/state";
  import { api } from "$lib/api/client";
  import { getWebSocketClient } from "$lib/api/websocket";
  import type { UISchema } from "$lib/types/schema";
  import { TabLayout, Layout as LegacyLayout } from "$lib/components/preview";
  import { PageContainer, PageHeader } from "$lib/components/layout";
  import { StateDisplay } from "$lib/components/ui";
  import { onMount } from "svelte";

  // Runtime mode: 'local' uses WebSocket, 'compute' uses Rhino Compute
  type RuntimeMode = "local" | "compute";

  let sessionId = $state("");
  let schema = $state<UISchema | null>(null);
  // Values stored by GUID (stable across parameter name changes)
  let values = $state<Record<string, any>>({});
  let loading = $state(true);
  let error = $state("");
  let wsClient = getWebSocketClient();
  let wsConnected = $state(false);
  let schemaUpdateNotification = $state("");
  let notificationTimer: ReturnType<typeof setTimeout> | null = null;

  // Determine runtime mode from URL parameter
  let runtimeMode = $state<RuntimeMode>("local");
  let solving = $state(false);

  // Track if we're updating values from remote (to avoid feedback loop)
  let isRemoteUpdate = $state(false);

  function getDefaultValue(paramType: string) {
    switch (paramType) {
      case "Number":
      case "Integer":
        return 0;
      case "Boolean":
        return false;
      case "Text":
        return "";
      default:
        return null;
    }
  }

  function showNotification(message: string, duration: number = 3000) {
    schemaUpdateNotification = message;
    if (notificationTimer) {
      clearTimeout(notificationTimer);
    }
    notificationTimer = setTimeout(() => {
      schemaUpdateNotification = "";
      notificationTimer = null;
    }, duration);
  }

  /**
   * Handle value changes from UI
   * Only send to Grasshopper if change came from user (not from remote)
   */
  async function handleValueChange(paramId: string, value: any) {
    // Skip sending if this is a remote update
    if (isRemoteUpdate) {
      console.log(
        "[Preview] Skipping send for remote update on paramId:",
        paramId
      );
      return;
    }

    // Update local values (using GUID as key)
    values[paramId] = value;

    if (runtimeMode === "local" && wsConnected && wsClient.isConnected) {
      console.log(
        "[Preview] Sending value update to Grasshopper (GUID keys):",
        { [paramId]: value }
      );

      // Send via WebSocket with GUID keys (what C# expects)
      wsClient.sendValueUpdate(sessionId, $state.snapshot(values));
    } else if (!wsClient.isConnected) {
      console.warn("[Preview] Cannot send values - WebSocket not connected");
    }
  }

  // Compute badge configuration
  const badgeConfig = $derived(
    runtimeMode === "local"
      ? wsConnected
        ? { label: "⚡ WebSocket Connected", variant: "connected" as const }
        : {
            label: "❌ WebSocket Disconnected",
            variant: "disconnected" as const,
          }
      : solving
        ? { label: "⚙️ Solving...", variant: "solving" as const }
        : { label: "☁️ Rhino Compute", variant: "compute" as const }
  );

  onMount(() => {
    const initializeSchema = async () => {
      sessionId = page.url.searchParams.get("session") || "";

      if (!sessionId && runtimeMode === "local") {
        error = "No session ID provided";
        loading = false;
        return;
      }

      if (runtimeMode === "local") {
        schema = await api.getSchema(sessionId);

        if (!schema) {
          error =
            "Schema not found. Please ensure the UI Builder component is enabled in Grasshopper.";
          loading = false;
          return;
        }
      }

      if (!schema) {
        error =
          "Schema not found. Please provide a valid schema or session ID.";
        loading = false;
        return;
      }

      if (!schema.layout.tabs) {
        schema.layout.tabs = [];
      }

      const availableParams = await api.getAvailableParameters(sessionId);

      schema.inputs.forEach((input) => {
        const availableParam = availableParams?.parameters.find(
          (p) => p.id === input.id
        );
        const defaultValue =
          availableParam?.default !== null &&
          availableParam?.default !== undefined
            ? availableParam.default
            : getDefaultValue(input.paramType);

        values[input.id] = defaultValue;
      });

      schema.outputs.forEach((output) => {
        values[output.id] = null;
      });

      if (runtimeMode === "local") {
        const connected = await wsClient.connect();

        if (connected) {
          console.log("[Preview] WebSocket connected");
          wsConnected = true;

          wsClient.on("currentValues", (message) => {
            if (message.sessionId === sessionId) {
              console.log("[Preview] Received current values:", message.values);
              isRemoteUpdate = true;
              values = { ...values, ...message.values };
              isRemoteUpdate = false;
            }
          });

          // Listen for output updates from Grasshopper (C# sends GUID keys)
          wsClient.on("outputs", (message) => {
            if (message.sessionId === sessionId) {
              console.log("[Preview] Received outputs:", message.outputs);
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
          });

          wsClient.on("outputUpdate", (message) => {
            if (message.sessionId === sessionId) {
              console.log("[Preview] Received output update:", message.outputs);
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
          });

          wsClient.on("schemaUpdated", (message) => {
            if (message.sessionId === sessionId) {
              console.log("[Preview] Schema updated:", {
                schema: message.schema,
                removedIds: message.removedIds,
              });

              const removedCount = message.removedIds?.length || 0;

              const newSchema = JSON.parse(JSON.stringify(message.schema));

              // Ensure layout has tabs array for backward compatibility
              if (!newSchema.layout.tabs) {
                newSchema.layout.tabs = [];
              }

              if (message.removedIds && message.removedIds.length > 0) {
                const newValues = { ...values };
                message.removedIds.forEach((id: string) => {
                  delete newValues[id];
                });
                values = newValues;

                console.log(
                  `[Preview] Removed ${message.removedIds.length} parameter(s) from UI`
                );
              }

              schema = null;

              setTimeout(() => {
                schema = newSchema;

                if (removedCount > 0) {
                  showNotification(
                    `Schema updated: ${removedCount} parameter${removedCount > 1 ? "s" : ""} removed`
                  );
                }
              }, 10);
            }
          });

          console.log("[Preview] Requesting current values from Grasshopper");
          wsClient.requestCurrentValues(sessionId);
        } else {
          error =
            "Failed to connect to Grasshopper via WebSocket. Make sure the UI Builder component is enabled and port 8765 is available.";
          loading = false;
          return;
        }
      }

      loading = false;
    };

    initializeSchema();
  });

  $effect(() => {
    return () => {
      if (wsConnected) {
        wsClient.disconnect();
      }
    };
  });
</script>

<PageContainer>
  <PageHeader
    title={schema?.name || "Interactive Preview"}
    badge={badgeConfig}
  />

  <div class="flex-1 overflow-auto bg-gray-50">
    {#if loading}
      <div class="flex items-center justify-center min-h-[400px]">
        <StateDisplay
          type="loading"
          size="large"
          message="Loading preview..."
        />
      </div>
    {:else if error}
      <div class="flex items-center justify-center min-h-[400px]">
        <StateDisplay type="error" size="large" message={error} />
      </div>
    {:else if schema}
      <div class="p-8 max-w-6xl mx-auto">
        {#if schema.layout.type === "tabbed" && schema.layout.tabs && schema.layout.tabs.length > 0}
          <TabLayout
            {schema}
            bind:values
            onValueChange={handleValueChange}
            debounceSliders={true}
          />
        {:else}
          <LegacyLayout
            {schema}
            bind:values
            onValueChange={handleValueChange}
            debounceSliders={true}
          />
        {/if}
      </div>
    {/if}
  </div>

  {#if schemaUpdateNotification}
    <div
      class="fixed bottom-8 right-8 bg-blue-600 text-white px-6 py-4 rounded-lg shadow-lg flex items-center gap-3 animate-[slideInRight_0.3s_ease-out] z-50"
    >
      <svg
        class="w-5 h-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
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
</style>
