<script lang="ts">
	import { ModeWatcher } from 'mode-watcher';
	import '../app.css';
	import { initializeFooterContext } from '@selva/shared';
	import { onMount, onDestroy } from 'svelte';
	import { useComputeHealth } from '$lib/composables/useComputeHealth.svelte';

	let { children } = $props();

	initializeFooterContext();

	// Initialize health check once for entire app (persists across page navigations)
	const computeHealth = useComputeHealth();
	onMount(() => computeHealth.startPeriodicCheck(10000));
	onDestroy(() => computeHealth.stopPeriodicCheck());
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
