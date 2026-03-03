<script lang="ts">
	import { ModeWatcher } from 'mode-watcher';
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
</svelte:head>

<ModeWatcher />
{@render children?.()}
