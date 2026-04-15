<script lang="ts">
	import type { Snippet } from 'svelte';
	import PageFooter from './PageFooter.svelte';

	interface PageContainerProps {
		background?: 'default' | 'white' | 'gray';
		class?: string;
		errors?: string[];
		warnings?: string[];
		children: Snippet;
		footerChildren?: Snippet;
	}

	let {
		background = 'default',
		class: className = '',
		errors = [],
		warnings = [],
		children,
		footerChildren
	}: PageContainerProps = $props();

	const backgroundClasses = {
		default: 'bg-background',
		white: 'bg-background',
		gray: 'bg-muted'
	};

	const combinedClasses = $derived(
		`flex flex-col h-screen overflow-hidden ${backgroundClasses[background]} ${className}`
	);
</script>

<div class={combinedClasses}>
	{@render children()}
	<div class="shrink-0">
		<PageFooter {errors} {warnings}>
			{#if footerChildren}
				{@render footerChildren()}
			{/if}
		</PageFooter>
	</div>
</div>
