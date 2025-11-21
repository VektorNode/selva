<script lang="ts">
	import InputHandler from '$lib/InputHandler.svelte';
	import { example2 } from '$lib/utils/data.js';
	import type { DataTree } from 'rhino-compute-core';

	console.log('Example Inputs:', example2);

	// const trees = inputsToDataTrees(exampleInputTypes);
</script>

<main>
	<h1>Rhino Compute UI Test</h1>
	<p>This is a test page for the InputHandler component with dummy data.</p>

	<InputHandler
		input={example2}
		onChange={(tree: DataTree[]) => {
			console.log(tree);
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
