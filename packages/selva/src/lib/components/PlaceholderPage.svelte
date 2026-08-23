<script lang="ts">
	import type { Component } from 'svelte';
	import { Construction } from '@lucide/svelte';

	interface PlaceholderPageProps {
		title: string;
		description?: string;
		icon?: Component;
	}

	let { title, description, icon }: PlaceholderPageProps = $props();
	const Icon = $derived(icon ?? Construction);
</script>

<div class="mx-auto flex max-w-xl flex-col items-center py-16 text-center">
	<div
		class="bg-accent text-accent-foreground mb-5 flex h-12 w-12 items-center justify-center rounded-full"
	>
		<Icon class="h-5 w-5" />
	</div>
	<h2 class="text-xl font-semibold tracking-tight">{title}</h2>
	{#if description}
		<p class="text-muted-foreground mt-2 max-w-sm text-sm">{description}</p>
	{/if}
	<p class="text-muted-foreground mt-6 text-xs tracking-wider uppercase">Coming soon</p>
</div>
