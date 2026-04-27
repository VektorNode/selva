<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ModeToggle } from '$lib/components/ui/mode-toggle';

	interface PageHeaderProps {
		homeUrl?: string;
		title?: string | null;
		logo?: string;
		navItems?: Snippet;
		rightContent?: Snippet;
		subnav?: Snippet;
		showModeToggle?: boolean;
		class?: string;
	}

	let {
		homeUrl = '/app',
		title = undefined,
		logo = '/favicon/favicon.svg',
		navItems,
		rightContent,
		subnav,
		showModeToggle = true,
		class: className = ''
	}: PageHeaderProps = $props();
</script>

<!-- Sticky top bar -->
<header
	class={`top-0 backdrop-blur-sm sticky z-40 border-b border-border bg-background/90 ${className}`}
>
	<div class="h-14 gap-5 px-6 flex items-center">
		<!-- Logo -->
		<a href={homeUrl} class="gap-2 flex shrink-0 items-center">
			<img src={logo} alt="" aria-hidden="true" class="h-5 w-5" />
			<span class="font-semibold text-sm tracking-tight">Selva</span>
		</a>

		{#if title}
			<span class="text-sm text-border">/</span>
			<span class="text-sm font-medium text-muted-foreground">{title}</span>
		{/if}

		<!-- Primary nav next to logo -->
		{#if navItems}
			<nav class="ml-5 gap-1 flex">
				{@render navItems()}
			</nav>
		{/if}

		<!-- Right cluster: identity + utilities, anchored flush-right -->
		<div class="gap-2 ml-auto flex items-center">
			{#if rightContent}
				{@render rightContent()}
			{/if}
			{#if showModeToggle}
				<ModeToggle />
			{/if}
		</div>
	</div>

	{#if subnav}
		<div class="h-10 px-6 flex items-center border-t border-border/60">
			{@render subnav()}
		</div>
	{/if}
</header>
