<script lang="ts">
	import type { Snippet } from 'svelte';
	import PageFooter from './PageFooter.svelte';

	interface PageContainerProps {
		background?: 'default' | 'white' | 'gray';
		class?: string;
		children: Snippet;
	}

	let { background = 'default', class: className = '', children }: PageContainerProps = $props();

	const backgroundClasses = {
		default: 'bg-muted',
		white: 'bg-background',
		gray: 'bg-muted'
	};

	const combinedClasses = $derived(
		`flex flex-col h-screen overflow-hidden ${backgroundClasses[background]} ${className} `
	);
</script>

<div class={combinedClasses}>
	{@render children()}
	<div class="z-50 mt-auto shrink-0">
		<PageFooter />
	</div>
</div>
