<script lang="ts">
	import { PageHeader, PageContent } from 'selva-shared';
	import UserChip from '$lib/components/UserChip.svelte';

	interface LayoutProps {
		children?: import('svelte').Snippet;
	}
	let { children }: LayoutProps = $props();
</script>

<PageHeader title="Definitions" homeUrl="/app">
	{#snippet rightContent()}
		<UserChip />
	{/snippet}
</PageHeader>

<PageContent>
	{@render children?.()}
</PageContent>
