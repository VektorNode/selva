<script lang="ts">
	import { PictureInPicture2, PanelRight } from '@lucide/svelte';
	import { RHINO_HOST_CONTAINER_EVENT, RHINO_TOGGLE_WINDOW_URL } from '$lib/app.config';

	type HostWindow = Window & { __selvaHostContainer?: string };

	let inWindow = $state((window as HostWindow).__selvaHostContainer === 'window');

	$effect(() => {
		const onContainer = (event: Event) => {
			inWindow = (event as CustomEvent<string>).detail === 'window';
		};
		window.addEventListener(RHINO_HOST_CONTAINER_EVENT, onContainer);
		return () => window.removeEventListener(RHINO_HOST_CONTAINER_EVENT, onContainer);
	});
</script>

<button
	type="button"
	class="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs"
	title={inWindow
		? 'Move the UI back into the Selva panel'
		: 'Move the UI into its own window, which can go fullscreen'}
	onclick={() => window.location.assign(RHINO_TOGGLE_WINDOW_URL)}
>
	{#if inWindow}
		<PanelRight class="h-3 w-3" />Dock
	{:else}
		<PictureInPicture2 class="h-3 w-3" />Pop out
	{/if}
</button>
