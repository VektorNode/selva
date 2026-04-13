<script lang="ts">
	import { ModeWatcher } from 'mode-watcher';
	import '../app.css';
	import { initializeFooterContext } from 'selva-shared';
	import { onMount } from 'svelte';
	import { useComputeHealth } from '$lib/composables/useComputeHealth.svelte';

	let { children } = $props();

	initializeFooterContext();

	const computeHealth = useComputeHealth();
	onMount(() => computeHealth.start());
</script>

<svelte:head>
	<title>Selva Compute</title>
	<meta
		name="description"
		content="Build and deploy interactive web applications powered by Grasshopper definitions with Selva Compute."
	/>
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
</svelte:head>

<ModeWatcher />
{@render children?.()}
