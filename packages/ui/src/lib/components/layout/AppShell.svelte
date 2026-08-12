<script lang="ts">
	import type { Snippet } from 'svelte';
	import PageHeader from './PageHeader.svelte';
	import PageFooter from './PageFooter.svelte';

	interface AppShellProps {
		showHeader?: boolean;
		homeUrl?: string;
		title?: string | null;
		logo?: string;
		brandName?: string;
		copyrightName?: string;
		showModeToggle?: boolean;
		navItems?: Snippet;
		rightContent?: Snippet;
		subnav?: Snippet;
		headerClass?: string;
		/**
		 * Replaces the built-in PageHeader inside the sticky header bar. The bar keeps the
		 * standard `--header-h` height so the fixed-mode layout math is unaffected.
		 */
		header?: Snippet;

		// 'fixed'  — viewport-locked, no page scroll; body owns its own scroll. For app-like
		//            pages (builder, preview, library/[guid]).
		// 'scroll' — normal page flow, footer sticks to the bottom. For dashboard-style pages.
		mode?: 'fixed' | 'scroll';

		// When present, body becomes a flex row: sidenav | main.
		sidenav?: Snippet;

		showFooter?: boolean;
		errors?: string[];
		warnings?: string[];
		/** Fully overrides the footer copyright line. `{name}` and `{year}` are substituted. */
		footerText?: string;
		footerChildren?: Snippet;

		class?: string;
		bodyClass?: string;
		children: Snippet;
	}

	let {
		showHeader = true,
		homeUrl = '/',
		title = undefined,
		logo = '/favicon/favicon.svg',
		brandName = 'Selva',
		copyrightName = undefined,
		showModeToggle = true,
		navItems,
		rightContent,
		subnav,
		headerClass = '',
		header,
		mode: _mode = 'scroll',
		sidenav,
		showFooter = false,
		errors = [],
		warnings = [],
		footerText,
		footerChildren,
		class: className = '',
		bodyClass = '',
		children
	}: AppShellProps = $props();

	const _copyright = $derived(copyrightName ?? brandName);

	const rootClass = $derived(
		_mode === 'fixed'
			? `flex flex-col h-screen overflow-hidden bg-background ${className}`
			: `flex flex-col min-h-screen bg-background ${className}`
	);

	const bodyShellClass = $derived(
		_mode === 'fixed'
			? `flex flex-1 min-h-0 ${sidenav ? 'flex-row' : 'flex-col'} ${bodyClass}`.trim()
			: `flex-1 ${sidenav ? 'flex flex-row' : ''} ${bodyClass}`.trim()
	);

	const bodyShellStyle = '';
</script>

<div class={rootClass}>
	{#if showHeader}
		{#if header}
			<header
				class={`top-0 backdrop-blur-sm sticky z-40 border-b border-border bg-background/90 ${headerClass}`}
			>
				<div class="flex h-(--header-h) items-center px-(--page-px)">
					{@render header()}
				</div>
			</header>
		{:else}
			<PageHeader
				{homeUrl}
				{title}
				{logo}
				{brandName}
				{showModeToggle}
				{navItems}
				{rightContent}
				{subnav}
				class={headerClass}
			/>
		{/if}
	{/if}

	<div class={bodyShellClass} style={bodyShellStyle}>
		{#if sidenav}
			{@render sidenav()}
			<main class="flex-1 overflow-y-auto">
				{@render children()}
			</main>
		{:else}
			{@render children()}
		{/if}
	</div>

	{#if showFooter}
		<div class="bottom-0 sticky z-10 shrink-0">
			<PageFooter {errors} {warnings} copyrightName={_copyright} {footerText}>
				{#if footerChildren}
					{@render footerChildren()}
				{/if}
			</PageFooter>
		</div>
	{/if}
</div>
