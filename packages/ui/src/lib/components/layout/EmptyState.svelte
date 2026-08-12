<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	interface Props {
		// Renders at h-8 w-8 above the title.
		icon?: Component<{ class?: string }>;
		title: string;
		description?: string;
		// Vertical breathing room. Most pages want `lg`; tighter contexts (drawer, nested card) use `sm`.
		size?: 'sm' | 'md' | 'lg';
		class?: string;
		// Overrides `description`. Use when the text needs rich content like <code>.
		body?: Snippet;
		actions?: Snippet;
	}

	let {
		icon: Icon,
		title,
		description,
		size = 'md',
		class: className = '',
		body,
		actions
	}: Props = $props();

	const padClass = $derived(size === 'sm' ? 'py-8' : size === 'lg' ? 'py-20' : 'p-12');
</script>

<div
	class={`flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-border text-center ${padClass} ${className}`}
>
	{#if Icon}
		<Icon class="mb-3 h-8 w-8 text-muted-foreground" />
	{/if}
	<p class="text-sm font-medium">{title}</p>
	{#if body}
		<div class="mt-1 text-sm text-muted-foreground">{@render body()}</div>
	{:else if description}
		<p class="mt-1 text-sm text-muted-foreground">{description}</p>
	{/if}
	{#if actions}
		<div class="mt-3 gap-2 flex items-center justify-center">
			{@render actions()}
		</div>
	{/if}
</div>
