<script lang="ts">
  import InputHandler from '$lib/InputHandler.svelte';
  import { exampleInputs2 } from '$lib/mocks/data.js';
</script>

<main>
  <h1>Rhino Compute UI Test</h1>
  <p>This is a test page for the InputHandler component with dummy data.</p>

  <InputHandler
    input={exampleInputs2}
    onChange={(tree: any[]) => {
      console.log('Input tree changed:', tree);
    }}
  ></InputHandler>
</main>

<style>
  main {
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
  }
</style>
