<script lang="ts">
	interface PageContentProps {
		class?: string;
		children?: import('svelte').Snippet;
	}

	let { class: className = '', children }: PageContentProps = $props();
</script>

<main class={`px-(--page-px) py-(--page-py) ${className}`}>
	{@render children?.()}
</main>
