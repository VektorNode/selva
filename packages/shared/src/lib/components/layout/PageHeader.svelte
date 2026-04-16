<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ModeToggle } from '$lib/components/ui/mode-toggle';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';

	interface PageHeaderProps {
		title: string;
		showModeToggle?: boolean;
		logo?: string;
		children?: Snippet;
		rightContent?: Snippet;
		class?: string;
	}

	let {
		title,
		logo = '/favicon/favicon.svg',
		children,
		rightContent,
		class: className = '',
		showModeToggle = false
	}: PageHeaderProps = $props();

	// Build home URL preserving current session/wsPort query params
	const homeUrl = $derived.by(() => {
		const session = page.url.searchParams.get('session');
		const wsPort = page.url.searchParams.get('wsPort');
		if (!session && !wsPort) return '/';
		const params = new SvelteURLSearchParams();
		if (session) params.set('session', session);
		if (wsPort) params.set('wsPort', wsPort);
		return `/?${params.toString()}`;
	});
</script>

<header
	class={`px-4 py-3 backdrop-blur-sm sm:px-6 mb-0 sm:mb-4 border-b border-border bg-linear-to-b from-background to-card transition-all duration-200 ${className}`}
>
	<div class="gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 flex flex-col">
		<div class="gap-2 min-w-0 sm:gap-3 flex flex-1 items-center">
			{#if logo}
				<a
					href={homeUrl}
					class="shrink-0 cursor-pointer transition-opacity hover:opacity-75"
					title="Go to home"
				>
					<img src={logo} alt="Logo" class="h-8 w-8" />
				</a>
			{/if}
			<h1 class="text-lg font-bold sm:text-2xl truncate text-foreground">
				{title}
			</h1>

			{#if showModeToggle && !rightContent}
				<div class="sm:hidden ml-auto">
					<ModeToggle />
				</div>
			{/if}

			{#if children}
				<div class="gap-2 text-xs sm:flex hidden flex-wrap items-center text-muted-foreground">
					{@render children()}
				</div>
			{/if}
		</div>

		{#if rightContent || showModeToggle}
			<div class="sm:flex gap-2 hidden items-center">
				{#if rightContent}
					{@render rightContent()}
				{/if}
				{#if showModeToggle}
					<ModeToggle />
				{/if}
			</div>
		{/if}
	</div>
</header>

<style>
	:global(header) {
		box-shadow:
			0 1px 3px rgba(0, 0, 0, 0.08),
			0 0 0 1px rgba(0, 0, 0, 0.02);
	}
</style>
