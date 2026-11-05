<script lang="ts">
	interface PageContentProps {
		class?: string;
		children?: import('svelte').Snippet;
	}

	let { class: className = '', children }: PageContentProps = $props();
</script>

<!-- One content width for every page, so moving between pages doesn't change the frame. -->
<div class={`max-w-6xl min-w-0 mx-auto w-full px-(--page-px) py-(--page-py) ${className}`}>
	{@render children?.()}
</div>
