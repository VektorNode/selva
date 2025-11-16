<script lang="ts">
  import type { OutputParameter } from "$lib/types/schema";

  interface Props {
    output: OutputParameter;
    value: any;
    displayName?: string;
  }

  let { output, value, displayName }: Props = $props();
</script>

<div class="parameter-display">
  <label>{displayName || output.name}</label>
  <div class="output-value">
    {#if value !== null && value !== undefined}
      {typeof value === "object"
        ? JSON.stringify(value, null, 2)
        : value}
    {:else}
      <span class="no-data">Waiting for data...</span>
    {/if}
  </div>
  {#if output.description}
    <p class="parameter-description">
      {output.description}
    </p>
  {/if}
</div>

<style>
  .parameter-display {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  label {
    font-weight: 500;
    color: #24292e;
    font-size: 0.9rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .output-value {
    padding: 0.75rem;
    background: #f6f8fa;
    border: 1px solid #e1e4e8;
    border-radius: 4px;
    font-family: monospace;
    min-height: 50px;
    font-size: 0.9rem;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .no-data {
    color: #959da5;
    font-style: italic;
    font-family:
      system-ui,
      -apple-system,
      sans-serif;
  }

  .parameter-description {
    font-size: 0.8rem;
    color: #586069;
    margin: 0;
    font-style: italic;
  }
</style>
