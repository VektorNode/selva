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

<div class="mx-auto max-w-xl py-16 flex flex-col items-center text-center">
	<div
		class="h-12 w-12 mb-5 rounded-full bg-accent text-accent-foreground flex items-center justify-center"
	>
		<Icon class="h-5 w-5" />
	</div>
	<h2 class="text-xl font-semibold tracking-tight">{title}</h2>
	{#if description}
		<p class="mt-2 max-w-sm text-sm text-muted-foreground">{description}</p>
	{/if}
	<p class="mt-6 text-xs uppercase tracking-wider text-muted-foreground">Coming soon</p>
</div>
