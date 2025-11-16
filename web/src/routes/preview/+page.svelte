<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { page } from "$app/stores";
  import { api } from "$lib/api/client";
  import { getWebSocketClient } from "$lib/api/websocket";
  import type { UISchema } from "$lib/types/schema";
  import TabLayout from "$lib/components/ui/TabLayout.svelte";
  import LegacyLayout from "$lib/components/ui/LegacyLayout.svelte";

  // Runtime mode: 'local' uses WebSocket, 'compute' uses Rhino Compute
  type RuntimeMode = "local" | "compute";

  let sessionId = "";
  let schema: UISchema | null = null;
  let values: Record<string, any> = {};
  let loading = true;
  let error = "";
  let wsClient = getWebSocketClient();
  let wsConnected = false;

  // Determine runtime mode from URL parameter
  let runtimeMode: RuntimeMode = "local";
  let solving = false;

  onMount(async () => {
    sessionId = $page.url.searchParams.get("session") || "";

    // Check URL parameter for mode (e.g., ?mode=compute)
    const modeParam = $page.url.searchParams.get("mode");
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

    // Initialize values with defaults using NAME as key (for UI compatibility)
    schema.inputs.forEach((input) => {
      values[input.name] = input.default ?? getDefaultValue(input.type);
    });

    // Outputs start with null - they'll be populated by live data from Grasshopper
    schema.outputs.forEach((output) => {
      values[output.name] = null;
    });

    // Setup WebSocket connection for local mode
    if (runtimeMode === "local") {
      const connected = await wsClient.connect();

      if (connected) {
        console.log("[Preview] WebSocket connected");
        wsConnected = true;

        // Listen for output updates from Grasshopper (C# sends GUID keys, convert to names)
        wsClient.on('outputs', (message) => {
          if (message.sessionId === sessionId) {
            console.log("[Preview] Received outputs:", message.outputs);
            // Convert from GUID keys to name keys for UI
            const outputsByName: Record<string, any> = {};
            schema.outputs.forEach((output) => {
              if (message.outputs[output.grasshopperId] !== undefined) {
                outputsByName[output.name] = message.outputs[output.grasshopperId];
              }
            });
            values = { ...values, ...outputsByName };
          }
        });

        // Also support 'outputUpdate' message type
        wsClient.on('outputUpdate', (message) => {
          if (message.sessionId === sessionId) {
            console.log("[Preview] Received output update:", message.outputs);
            // Convert from GUID keys to name keys for UI
            const outputsByName: Record<string, any> = {};
            schema.outputs.forEach((output) => {
              if (message.outputs[output.grasshopperId] !== undefined) {
                outputsByName[output.name] = message.outputs[output.grasshopperId];
              }
            });
            values = { ...values, ...outputsByName };
          }
        });
      } else {
        error = "Failed to connect to Grasshopper via WebSocket. Make sure the UI Builder component is enabled and port 8765 is available.";
        loading = false;
        return;
      }
    }

    loading = false;
  });

  onDestroy(() => {
    if (wsConnected) {
      wsClient.disconnect();
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

  /**
   * Handle value changes from UI
   * Receives parameter NAME from UI, converts to GUID for WebSocket
   */
  async function handleValueChange(parameterName: string, value: any) {
    // Update local values (using name as key for UI)
    values[parameterName] = value;

    if (runtimeMode === "local" && wsConnected && wsClient.isConnected) {
      // Convert from name-based keys to GUID-based keys for C#
      const inputValuesByGuid: Record<string, any> = {};

      schema?.inputs.forEach((input) => {
        if (values[input.name] !== undefined) {
          // Map name → GUID
          inputValuesByGuid[input.grasshopperId] = values[input.name];
        }
      });

      console.log("[Preview] Sending value update to Grasshopper (GUID keys):", inputValuesByGuid);

      // Send via WebSocket with GUID keys (what C# expects)
      wsClient.sendValueUpdate(sessionId, inputValuesByGuid);
    } else if (!wsClient.isConnected) {
      console.warn("[Preview] Cannot send values - WebSocket not connected");
    }
  }
</script>

<div class="container">
  <header>
    <h1>Interactive Preview</h1>
    {#if sessionId || runtimeMode === "compute"}
      <p class="session-info">
        {#if runtimeMode === "local"}
          Session: {sessionId}
          {#if !loading}
            <span
              class="connection-badge"
              class:connected={wsConnected}
              class:disconnected={!wsConnected}
            >
              {wsConnected ? "⚡ WebSocket Connected" : "❌ WebSocket Disconnected"}
            </span>
          {/if}
        {:else}
          <span class="connection-badge compute">
            {solving ? "⚙️ Solving..." : "☁️ Rhino Compute"}
          </span>
        {/if}
      </p>
    {/if}
  </header>

  {#if loading}
    <div class="loading">Loading preview...</div>
  {:else if error}
    <div class="error">{error}</div>
  {:else if schema}
    <div class="preview">
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

<style>
  .container {
    min-height: 100vh;
    background: #f5f7fa;
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
  }

  header {
    background: white;
    border-bottom: 1px solid #e1e4e8;
    padding: 1.5rem 2rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  }

  h1 {
    font-size: 1.75rem;
    margin: 0 0 0.5rem 0;
    color: #24292e;
  }

  .session-info {
    color: #586069;
    font-size: 0.9rem;
    display: flex;
    align-items: center;
    gap: 1rem;
    margin: 0;
  }

  .connection-badge {
    display: inline-block;
    padding: 0.25rem 0.75rem;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .connection-badge.connected {
    background: #4caf50;
    color: white;
  }

  .connection-badge.disconnected {
    background: #f44336;
    color: white;
  }

  .connection-badge.compute {
    background: #2196f3;
    color: white;
  }

  .loading,
  .error {
    padding: 4rem 2rem;
    text-align: center;
    background: white;
    border-radius: 8px;
    margin: 2rem;
  }

  .error {
    background: #fee;
    color: #c00;
  }

  .preview {
    padding: 2rem;
    max-width: 1400px;
    margin: 0 auto;
  }
</style>
