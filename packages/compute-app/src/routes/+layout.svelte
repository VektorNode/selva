<script lang="ts">
	import { ModeWatcher } from 'mode-watcher';
	import '../app.css';
	import { initializeFooterContext, Toaster } from '@selvajs/ui';

	let { data, children } = $props();

	initializeFooterContext();
</script>

<svelte:head>
	<title>{data.branding.name}</title>
	<meta name="description" content={data.branding.description} />
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
</svelte:head>

<ModeWatcher />
<Toaster />
{@render children?.()}
