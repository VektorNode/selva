<script lang="ts">
	interface PageContentProps {
		class?: string;
		children?: import('svelte').Snippet;
	}

	let { class: className = '', children }: PageContentProps = $props();
</script>

<main class={`px-6 py-7 ${className}`}>
	{@render children?.()}
</main>
