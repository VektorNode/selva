<script lang="ts">
	interface LayoutProps {
		children?: import('svelte').Snippet;
	}
	let { children }: LayoutProps = $props();
</script>

{@render children?.()}
