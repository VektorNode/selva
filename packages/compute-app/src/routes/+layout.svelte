<script lang="ts">
	import { ModeWatcher } from 'mode-watcher';
	import '../app.css';
	import { initializeFooterContext, Toaster } from '@selvajs/shared';

	let { children } = $props();

	initializeFooterContext();
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
<Toaster />
{@render children?.()}
