<script lang="ts">
	import type { FooterItem } from '$lib/contexts/footerContext.svelte';

	let { item }: { item: FooterItem } = $props();

	const props = $derived(item.getProps());
</script>

{#if item.onClick}
	<button
		onclick={item.onClick}
		class="flex items-center gap-1.5 px-2 py-0.5 rounded transition-colors hover:bg-muted cursor-pointer"
	>
		<item.component {...props} />
	</button>
{:else}
	<div class="flex items-center">
		<item.component {...props} />
	</div>
{/if}
