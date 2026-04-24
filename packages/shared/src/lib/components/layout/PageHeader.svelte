<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ModeToggle } from '$lib/components/ui/mode-toggle';

	interface PageHeaderProps {
		homeUrl?: string;
		title?: string | null;
		logo?: string;
		navItems?: Snippet;
		rightContent?: Snippet;
		showModeToggle?: boolean;
		class?: string;
	}

	let {
		homeUrl = '/app',
		title = undefined,
		logo = '/favicon/favicon.svg',
		navItems,
		rightContent,
		showModeToggle = true,
		class: className = ''
	}: PageHeaderProps = $props();
</script>

<!-- Sticky top bar -->
<header class={`sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-sm ${className}`}>
	<div class="flex h-14 items-center gap-5 px-6">
		<!-- Logo -->
		<a href={homeUrl} class="flex items-center gap-2 shrink-0">
			<img src={logo} alt="" aria-hidden="true" class="h-5 w-5" />
			<span class="font-semibold text-sm tracking-tight">Selva</span>
		</a>

		{#if title}
			<span class="text-border text-sm">/</span>
			<span class="text-sm font-medium text-muted-foreground">{title}</span>
		{/if}

		<!-- Nav items -->
		{#if navItems}
			<nav class="ml-5 flex gap-1">
				{@render navItems()}
			</nav>
		{/if}

		<!-- Right content -->
		<div class="ml-auto flex items-center gap-2">
			{#if rightContent}
				{@render rightContent()}
			{/if}
			{#if showModeToggle}
				<ModeToggle />
			{/if}
		</div>
	</div>
</header>
