<script lang="ts">
  import { page } from "$app/state";
  import { api } from "$lib/api/client";
  import { getWebSocketClient } from "$lib/api/websocket";
  import type { UISchema } from "$lib/types/schema";
  import TabLayout from "$lib/components/ui/TabLayout.svelte";
  import LegacyLayout from "$lib/components/ui/Layout.svelte";
  import {
    PageContainer,
    PageHeader,
    StateDisplay,
  } from "$lib/components/shared";

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

  // Determine runtime mode from URL parameter
  let runtimeMode = $state<RuntimeMode>("local");
  let solving = $state(false);

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

  /**
   * Handle value changes from UI
   * Now receives parameter GUID directly (no conversion needed)
   */
  async function handleValueChange(paramId: string, value: any) {
    // Update local values (using GUID as key)
    values[paramId] = value;

    if (runtimeMode === "local" && wsConnected && wsClient.isConnected) {
      console.log(
        "[Preview] Sending value update to Grasshopper (GUID keys):",
        { [paramId]: value }
      );

      // Send via WebSocket with GUID keys (what C# expects)
      wsClient.sendValueUpdate(sessionId, values);
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

  // Initialize on mount
  $effect.pre(() => {
    const initializeSchema = async () => {
      sessionId = page.url.searchParams.get("session") || "";

      // Check URL parameter for mode (e.g., ?mode=compute)
      const modeParam = page.url.searchParams.get("mode");
      if (modeParam === "compute") {
        runtimeMode = "compute";
      }

      if (!sessionId && runtimeMode === "local") {
        error = "No session ID provided";
        loading = false;
        return;
      }

      // Load schema from session
      if (runtimeMode === "local") {
        schema = await api.getSchema(sessionId);

        if (!schema) {
          error =
            "Schema not found. Please ensure the UI Builder component is enabled in Grasshopper.";
          loading = false;
          return;
        }
      } else {
        // For compute mode, try loading from session if provided
        if (sessionId) {
          schema = await api.getSchema(sessionId);
        }

        if (!schema) {
          error =
            "Schema not found. Please provide a valid schema or session ID.";
          loading = false;
          return;
        }
      }

      // Ensure layout has tabs array for backward compatibility
      if (!schema.layout.tabs) {
        schema.layout.tabs = [];
      }

      // Load available parameters to get default values (not stored in schema)
      const availableParams = await api.getAvailableParameters(sessionId);

      // Initialize values with defaults using GUID as key (stable across name changes)
      schema.inputs.forEach((input) => {
        // Get default from available parameters (live from Grasshopper)
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

      // Outputs start with null - they'll be populated by live data from Grasshopper
      schema.outputs.forEach((output) => {
        values[output.id] = null;
      });

      // Setup WebSocket connection for local mode
      if (runtimeMode === "local") {
        const connected = await wsClient.connect();

        if (connected) {
          console.log("[Preview] WebSocket connected");
          wsConnected = true;

          // Listen for current input values from Grasshopper
          wsClient.on("currentValues", (message) => {
            if (message.sessionId === sessionId) {
              console.log("[Preview] Received current values:", message.values);
              // C# sends GUID keys - use them directly
              values = { ...values, ...message.values };
            }
          });

          // Listen for output updates from Grasshopper (C# sends GUID keys)
          wsClient.on("outputs", (message) => {
            if (message.sessionId === sessionId) {
              console.log("[Preview] Received outputs:", message.outputs);
              // C# sends GUID keys - use them directly
              values = { ...values, ...message.outputs };
            }
          });

          // Also support 'outputUpdate' message type
          wsClient.on("outputUpdate", (message) => {
            if (message.sessionId === sessionId) {
              console.log("[Preview] Received output update:", message.outputs);
              // C# sends GUID keys - use them directly
              values = { ...values, ...message.outputs };
            }
          });

          // Request current values from Grasshopper on initial connection
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

  // Cleanup on destroy
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
</PageContainer>
