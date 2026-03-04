<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { ModeToggle } from '$lib/components/ui/mode-toggle';
	import { page } from '$app/state';

	//Maybe in the future again
	// import { ThemeSwitcher } from '../../ui/theme-switcher';

	interface BadgeConfig {
		label: string;
		variant: 'connected' | 'disconnected' | 'solving' | 'compute';
	}

	interface PageHeaderProps {
		title: string;
		sessionId?: string;
		badge?: BadgeConfig;
		showModeToggle?: boolean;
		logo?: string;
		children?: Snippet;
		rightContent?: Snippet;
		class?: string;
	}

	let {
		title,
		sessionId,
		badge,
		logo = '/favicon/favicon.svg',
		children,
		rightContent,
		class: className = '',
		showModeToggle = false
	}: PageHeaderProps = $props();

	// Map custom variants to colors
	const badgeStyles: Record<string, string> = {
		connected: 'bg-success text-success-foreground border-transparent',
		disconnected: 'bg-background text-destructive border border-destructive',
		solving: 'bg-warning text-warning-foreground border-transparent',
		compute: 'bg-info text-info-foreground border-transparent'
	};

	// Build home URL preserving current session/wsPort query params
	const homeUrl = $derived.by(() => {
		const params = new URLSearchParams();
		const session = page.url.searchParams.get('session');
		const wsPort = page.url.searchParams.get('wsPort');
		if (session) params.set('session', session);
		if (wsPort) params.set('wsPort', wsPort);
		const query = params.toString();
		return query ? `/?${query}` : '/';
	});
</script>

<header
	class={`px-4 py-3 backdrop-blur-sm sm:px-6 mb-0 sm:mb-4 border-b border-border bg-linear-to-b from-background to-card transition-all duration-200 ${className}`}
>
	<div class="gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 flex flex-col">
		<!-- Left section -->
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

			{#if sessionId || badge || children}
				<div class="gap-2 text-xs sm:flex hidden flex-wrap items-center text-muted-foreground">
					{#if children}
						{@render children()}
					{/if}

					{#if sessionId}
						<span class="gap-1.5 flex max-w-full items-center">
							<span class="shrink-0">Session:</span>
							<code
								class="rounded px-2 py-0.5 font-mono text-xs font-medium truncate bg-muted text-foreground"
							>
								{sessionId}
							</code>
						</span>
					{/if}

					{#if sessionId && (badge || children)}
						<div class="h-3 w-px bg-border"></div>
					{/if}

					{#if badge}
						<Badge class={badgeStyles[badge.variant]}>
							{badge.label}
						</Badge>
					{/if}
				</div>
			{/if}
		</div>

		<!-- Right section (rightContent + ModeToggle) -->
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

	<!-- Mobile badge section -->
	{#if (sessionId || badge || children || rightContent) && (sessionId || badge)}
		<div class="mt-2 gap-2 text-xs sm:hidden flex flex-wrap items-center text-muted-foreground">
			{#if children}
				{@render children()}
			{/if}

			{#if sessionId}
				<span class="gap-1.5 min-w-0 flex items-center">
					<span class="shrink-0">Session:</span>
					<code
						class="rounded px-1.5 py-0.5 font-mono text-xs font-medium truncate bg-muted text-foreground"
					>
						{sessionId}
					</code>
				</span>
			{/if}

			{#if sessionId && badge}
				<div class="h-3 w-px bg-border"></div>
			{/if}

			{#if badge}
				<Badge class={badgeStyles[badge.variant]}>
					{badge.label}
				</Badge>
			{/if}

			{#if rightContent}
				<div class="gap-2 ml-auto flex items-center">
					{@render rightContent()}
				</div>
			{/if}
		</div>
	{/if}
</header>

<style>
	:global(header) {
		box-shadow:
			0 1px 3px rgba(0, 0, 0, 0.08),
			0 0 0 1px rgba(0, 0, 0, 0.02);
	}
</style>
