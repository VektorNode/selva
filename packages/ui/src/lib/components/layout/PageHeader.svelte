<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ModeToggle } from '#lib/components/primitives/mode-toggle/index.js';

	interface PageHeaderProps {
		homeUrl?: string;
		title?: string | null;
		logo?: string;
		brandName?: string;
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
		brandName = 'Selva',
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
	<div class="gap-2 sm:gap-5 flex h-(--header-h) items-center px-(--page-px)">
		<!-- Logo -->
		<a href={homeUrl} class="gap-2 flex shrink-0 items-center" aria-label={brandName}>
			<img src={logo} alt="" aria-hidden="true" class="h-5 w-5" />
			<!-- On a phone the page title needs the room more than the brand does. -->
			<span
				class="font-semibold text-sm tracking-tight {title !== undefined ? 'sm:inline hidden' : ''}"
				>{brandName}</span
			>
		</a>

		{#if title !== undefined}
			<span class="text-sm shrink-0 text-border">/</span>
			<span class="text-sm font-medium min-w-0 truncate text-muted-foreground">{title ?? ''}</span>
		{/if}

		<!-- Primary nav next to logo -->
		{#if navItems}
			<nav class="sm:ml-5 gap-1 flex shrink-0">
				{@render navItems()}
			</nav>
		{/if}

		<!-- Right cluster: identity + utilities, anchored flush-right -->
		<div class="gap-2 ml-auto flex shrink-0 items-center">
			{#if rightContent}
				{@render rightContent()}
			{/if}
			{#if showModeToggle}
				<ModeToggle />
			{/if}
		</div>
	</div>

	{#if subnav}
		<div class="h-10 flex items-center border-t border-border/60 px-(--page-px)">
			{@render subnav()}
		</div>
	{/if}
</header>
