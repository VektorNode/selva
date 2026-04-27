<script lang="ts">
	import type { Snippet } from 'svelte';

	interface SectionHeaderProps {
		eyebrow?: string;
		title: string;
		description?: string;
		actions?: Snippet;
		class?: string;
	}

	let {
		eyebrow,
		title,
		description,
		actions,
		class: className = ''
	}: SectionHeaderProps = $props();
</script>

<div class={`mb-6 gap-5 flex items-start justify-between ${className}`}>
	<div class="min-w-0">
		{#if eyebrow}
			<div class="mb-1.5 text-xs font-medium tracking-wider text-muted-foreground uppercase">
				{eyebrow}
			</div>
		{/if}
		<h1 class="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
		{#if description}
			<p class="mt-1 max-w-xl text-sm text-muted-foreground">{description}</p>
		{/if}
	</div>
	{#if actions}
		<div class="gap-2 flex shrink-0 items-center">
			{@render actions()}
		</div>
	{/if}
</div>
