<script lang="ts">
	import { ModeWatcher, mode } from 'mode-watcher';
	import '../app.css';
	import { initializeFooterContext } from '@selva/shared';
	import { initializeFooterContext } from '@selva/shared';

	let { children } = $props();

	initializeFooterContext();
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
</svelte:head>

<ModeWatcher />
{@render children?.()}
