<script lang="ts">
	import { ModeWatcher, mode } from 'mode-watcher';
	import '../app.css';
	import { initializeFooterContext } from '@selva/shared';

	let { children } = $props();

	initializeFooterContext();
</script>

<svelte:head>
	<title>Selva Compute</title>
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
</svelte:head>

<ModeWatcher />
{@render children?.()}
