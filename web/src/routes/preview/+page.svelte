<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { page } from "$app/stores";
  import { api } from "$lib/api/client";
  import { getWebSocketClient, connectWithFallback } from "$lib/api/websocket";
  import type { UISchema } from "$lib/types/schema";
  import TabLayout from "$lib/components/ui/TabLayout.svelte";
  import LegacyLayout from "$lib/components/ui/LegacyLayout.svelte";

  // Runtime mode: 'local' uses WebSocket/polling, 'compute' uses Rhino Compute
  type RuntimeMode = "local" | "compute";

  let sessionId = "";
  let schema: UISchema | null = null;
  let values: Record<string, any> = {};
  let loading = true;
  let error = "";
  let stopPolling: (() => void) | null = null;
  let connectionMode: "websocket" | "polling" = "polling";
  let wsClient = getWebSocketClient();

  // Determine runtime mode from URL parameter or environment variable
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

    // Load schema (from session for local mode, from API for compute mode)
    if (runtimeMode === "local") {
      schema = await api.getSchema(sessionId);

      if (!schema) {
        error =
          "Schema not found. Please ensure the Interactive component is active in Grasshopper.";
        loading = false;
        return;
      }
    } else {
      // For compute mode, schema should be provided via URL or loaded from server
      // For now, try loading from session if provided, otherwise show error
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

    // Initialize values with defaults for inputs only
    schema.inputs.forEach((input) => {
      values[input.name] = input.default ?? getDefaultValue(input.type);
    });

    // Outputs start with null - they'll be populated by live data from Grasshopper
    schema.outputs.forEach((output) => {
      values[output.name] = null;
    });

    // Setup connection for local mode
    if (runtimeMode === "local") {
      connectionMode = await connectWithFallback(sessionId, (outputs) => {
        console.log("Received outputs from Grasshopper:", outputs);
        // Update output values with reactivity trigger
        values = { ...values, ...outputs };
      });

      if (connectionMode === "websocket") {
        console.log("Using WebSocket for real-time communication");
      } else {
        console.log("Using file-based polling");
        stopPolling = await api.pollValues(sessionId, (runtimeValues) => {
          console.log("Polled values:", runtimeValues.values);
          values = { ...values, ...runtimeValues.values };
        });
      }
    }
    loading = false;
  });

  onDestroy(() => {
    if (stopPolling) stopPolling();
    if (connectionMode === "websocket") {
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

  async function handleValueChange(parameterName: string, value: any) {
    values[parameterName] = value;

    if (runtimeMode === "local") {
      // Filter to only send input values (exclude outputs)
      const inputValues: Record<string, any> = {};
      schema?.inputs.forEach((input) => {
        if (values[input.name] !== undefined) {
          inputValues[input.name] = values[input.name];
        }
      });

      // Local mode: send to Grasshopper via WebSocket or polling
      if (connectionMode === "websocket" && wsClient.isConnected) {
        wsClient.sendValueUpdate(sessionId, inputValues);
      } else {
        await api.updateValues(sessionId, inputValues);
      }
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
              class:websocket={connectionMode === "websocket"}
              class:polling={connectionMode === "polling"}
            >
              {connectionMode === "websocket" ? "⚡ WebSocket" : "📡 Polling"}
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

  .connection-badge.websocket {
    background: #4caf50;
    color: white;
  }

  .connection-badge.polling {
    background: #ff9800;
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
