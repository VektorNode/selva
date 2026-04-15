<script lang="ts">
	import type { FooterItem } from '$lib/contexts/footerContext.svelte';

	let { item }: { item: FooterItem } = $props();

	const itemProps = $derived(item.getProps());
</script>

{#if item.onClick}
	<button
		onclick={item.onClick}
		class="gap-1.5 px-2 py-0.5 rounded flex cursor-pointer items-center transition-colors hover:bg-muted"
	>
		<item.component {...itemProps} />
	</button>
{:else}
	<div class="flex items-center">
		<item.component {...itemProps} />
	</div>
{/if}
