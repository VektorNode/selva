<script lang="ts">
	import { ModeWatcher, mode } from 'mode-watcher';
	import '../app.css';
	import { initializeFooterContext } from '@selva/shared';

	let { children } = $props();

	initializeFooterContext();

	$effect(() => {
		const current = mode.current;
		document.documentElement.classList.toggle('dark', current === 'dark');
		document.documentElement.style.colorScheme = current === 'dark' ? 'dark' : 'light';
	});
</script>

<svelte:head>
	<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
</svelte:head>

<ModeWatcher defaultMode="system" darkClassNames={['dark']} />
{@render children?.()}
