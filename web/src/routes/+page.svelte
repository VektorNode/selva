<script lang="ts">
  import { page } from "$app/state";
  import { onMount } from "svelte";

  var sessionId = page.url.searchParams.get("session");
  let mode: "home" | "builder" | "preview" = "home";

  // Allow switching modes without navigation
  function switchMode(newMode: "builder" | "preview") {
    mode = newMode;
  }
</script>

<div class="container">
  {#if !sessionId}
    <div class="error">
      <h2>No Session ID</h2>
      <p>
        No session ID provided in URL. Please start from the Grasshopper
        component.
      </p>
    </div>
  {:else}
    <header>
      <h1>ComputeBuilder</h1>
      <p class="session-info">Session: {sessionId}</p>

      <nav class="mode-switcher">
        <button class:active={mode === "home"} onclick={() => (mode = "home")}>
          Home
        </button>
        <button
          class:active={mode === "builder"}
          onclick={() => switchMode("builder")}
        >
          Schema Builder
        </button>
        <button
          class:active={mode === "preview"}
          onclick={() => switchMode("preview")}
        >
          Interactive Preview
        </button>
      </nav>
    </header>

    <main>
      {#if mode === "home"}
        <div class="welcome">
          <h2>Welcome to ComputeBuilder</h2>
          <p>Choose a mode to get started:</p>
          <div class="mode-cards">
            <button class="mode-card" onclick={() => switchMode("builder")}>
              <h3>🔧 Schema Builder</h3>
              <p>
                Configure your UI schema by selecting inputs and outputs from
                your Grasshopper definition
              </p>
            </button>
            <button class="mode-card" onclick={() => switchMode("preview")}>
              <h3>⚡ Interactive Preview</h3>
              <p>
                Interact with your Grasshopper definition in real-time with live
                parameter updates
              </p>
            </button>
          </div>
        </div>
      {:else if mode === "builder"}
        <iframe src="/builder?session={sessionId}" title="Schema Builder"
        ></iframe>
      {:else if mode === "preview"}
        <iframe src="/preview?session={sessionId}" title="Interactive Preview"
        ></iframe>
      {/if}
    </main>
  {/if}
</div>

<style>
  .container {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .error {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2rem;
    text-align: center;
  }

  .error h2 {
    color: #d32f2f;
    margin-bottom: 1rem;
  }

  header {
    background: white;
    border-bottom: 1px solid #e0e0e0;
    padding: 1rem 2rem;
  }

  h1 {
    font-size: 1.5rem;
    margin: 0 0 0.5rem 0;
  }

  .session-info {
    font-size: 0.85rem;
    color: #666;
    margin: 0 0 1rem 0;
  }

  .mode-switcher {
    display: flex;
    gap: 0.5rem;
  }

  .mode-switcher button {
    padding: 0.5rem 1rem;
    background: transparent;
    border: 1px solid #ddd;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
    transition: all 0.2s;
  }

  .mode-switcher button:hover {
    background: #f5f5f5;
  }

  .mode-switcher button.active {
    background: #1976d2;
    color: white;
    border-color: #1976d2;
  }

  main {
    flex: 1;
    display: flex;
    flex-direction: column;
  }

  .welcome {
    padding: 3rem 2rem;
    max-width: 900px;
    margin: 0 auto;
  }

  .welcome h2 {
    font-size: 2rem;
    margin-bottom: 1rem;
  }

  .welcome > p {
    color: #666;
    margin-bottom: 2rem;
  }

  .mode-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 2rem;
  }

  .mode-card {
    background: white;
    border: 2px solid #e0e0e0;
    border-radius: 8px;
    padding: 2rem;
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
  }

  .mode-card:hover {
    border-color: #1976d2;
    box-shadow: 0 4px 12px rgba(25, 118, 210, 0.15);
    transform: translateY(-2px);
  }

  .mode-card h3 {
    font-size: 1.25rem;
    margin: 0 0 0.75rem 0;
  }

  .mode-card p {
    color: #666;
    margin: 0;
    line-height: 1.5;
  }

  iframe {
    flex: 1;
    width: 100%;
    border: none;
  }
</style>
