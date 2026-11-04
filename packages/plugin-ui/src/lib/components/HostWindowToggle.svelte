<script lang="ts">
	import { PictureInPicture2, PanelRight } from '@lucide/svelte';
	import { RHINO_TOGGLE_WINDOW_URL } from '#lib/app.config.js';
	import { rhinoHostContainer } from '#lib/utils/rhino-host.svelte.js';

	const inWindow = $derived(rhinoHostContainer.current === 'window');
	const label = $derived(
		inWindow
			? 'Dock: move the UI back into the Selva panel'
			: 'Pop out: move the UI into its own window'
	);
</script>

<button
	type="button"
	class="text-muted-foreground hover:text-foreground flex items-center"
	title={label}
	aria-label={label}
	onclick={() => window.location.assign(RHINO_TOGGLE_WINDOW_URL)}
>
	{#if inWindow}
		<PanelRight class="h-3.5 w-3.5" />
	{:else}
		<PictureInPicture2 class="h-3.5 w-3.5" />
	{/if}
</button>
