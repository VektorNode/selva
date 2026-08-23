<script lang="ts">
	import { page } from '$app/state';
	import { ModeWatcher } from 'mode-watcher';
	import '../app.css';

	let { children } = $props();

	// `?theme=` lets an embedding host pin light/dark; anything else follows the system.
	let theme = $derived(page.url.searchParams.get('theme'));
	let defaultMode = $derived<'light' | 'dark' | 'system'>(
		theme === 'light' || theme === 'dark' ? theme : 'system'
	);
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
</svelte:head>

<ModeWatcher {defaultMode} />
{@render children?.()}
