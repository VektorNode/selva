<script lang="ts">
  import InputHandler from '$lib/InputHandler.svelte';
  import { exampleInputs } from '$lib/utils/data.js';
  import type { DataTree } from '@selva/core';
</script>

<main>
  <h1>Rhino Compute UI Test</h1>
  <p>This is a test page for the InputHandler component with dummy data.</p>

  <InputHandler
    input={exampleInputs}
    onChange={(tree: DataTree[]) => {
      console.log('Input tree changed:', tree);
    }}
    autoUpdate={true}
  ></InputHandler>
</main>

<style>
  main {
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
  }
</style>
