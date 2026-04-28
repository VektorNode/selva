<script lang="ts">
	import AppHeader from '$lib/components/AppHeader.svelte';

	interface LayoutProps {
		children?: import('svelte').Snippet;
	}
	let { children }: LayoutProps = $props();
</script>

<AppHeader mode="fixed">
	{@render children?.()}
</AppHeader>
