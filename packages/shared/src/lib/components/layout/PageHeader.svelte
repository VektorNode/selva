<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { ModeToggle } from '$lib/components/ui/mode-toggle';

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
		class?: string;
	}

	let {
		title,
		sessionId,
		badge,
		logo = '/favicon/favicon.svg',
		children,
		class: className = '',
		showModeToggle = false
	}: PageHeaderProps = $props();

	// Map custom variants to colors
	const badgeStyles: Record<string, string> = {
		connected: 'bg-green-500 text-white border-transparent',
		disconnected: 'bg-red-500 text-white border-transparent',
		solving: 'bg-orange-500 text-white border-transparent',
		compute: 'bg-blue-500 text-white border-transparent'
	};
</script>

<header
	class={`px-6 py-3 backdrop-blur-sm border-b border-border bg-linear-to-b from-background to-muted/50 transition-all duration-200 ${className}`}
>
	<div class="gap-3 sm:flex-row sm:items-center sm:justify-between flex flex-col">
		<!-- Left section -->
		<div class="min-w-0 gap-3 flex flex-1 items-center">
			{#if logo}
				<a
					href="/"
					class="cursor-pointer transition-opacity hover:opacity-75"
					title="Go to home"
					data-sveltekit-reload
				>
					<img src={logo} alt="Logo" class="h-8 w-8 shrink-0" />
				</a>
			{/if}
			<h1 class="text-xl font-bold sm:text-2xl text-foreground">
				{title}
			</h1>

			{#if sessionId || badge || children}
				<div class="mt-1 gap-2 text-xs flex flex-wrap items-center text-muted-foreground">
					{#if children}
						{@render children()}
					{/if}

					{#if sessionId}
						<span class="gap-1.5 flex max-w-full items-center">
							<span>Session:</span>
							<code
								class="rounded px-2 py-0.5 font-mono text-xs font-medium sm:max-w-none max-w-[60vw] truncate bg-muted text-foreground"
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

		<!-- Right section (Theme & Mode Toggle) -->
		{#if showModeToggle}
			<div class="gap-2 sm:self-center flex items-center self-start">
				<ModeToggle />
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
