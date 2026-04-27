<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	interface Props {
		// Optional icon component (e.g. lucide). Renders at h-8 w-8 above the title.
		icon?: Component<{ class?: string }>;
		title: string;
		description?: string;
		// Vertical breathing room. Most pages want `lg`; tighter contexts (drawer, nested card) use `sm`.
		size?: 'sm' | 'md' | 'lg';
		class?: string;
		// Free-form description (overrides plain `description`). Use when you need rich content like <code>.
		body?: Snippet;
		// Buttons / links rendered below.
		actions?: Snippet;
	}

	let { icon: Icon, title, description, size = 'md', class: className = '', body, actions }: Props =
		$props();

	const padClass = $derived(
		size === 'sm' ? 'py-8' : size === 'lg' ? 'py-20' : 'p-12'
	);
</script>

<div
	class={`border-border flex flex-col items-center justify-center rounded-lg border-2 border-dashed text-center ${padClass} ${className}`}
>
	{#if Icon}
		<Icon class="text-muted-foreground mb-3 h-8 w-8" />
	{/if}
	<p class="text-sm font-medium">{title}</p>
	{#if body}
		<div class="text-muted-foreground mt-1 text-sm">{@render body()}</div>
	{:else if description}
		<p class="text-muted-foreground mt-1 text-sm">{description}</p>
	{/if}
	{#if actions}
		<div class="mt-3 flex items-center justify-center gap-2">
			{@render actions()}
		</div>
	{/if}
</div>
