<script lang="ts">
	import type { Snippet } from 'svelte';
	import PageHeader from './PageHeader.svelte';
	import PageFooter from './PageFooter.svelte';

	interface AppShellProps {
		// Header
		showHeader?: boolean;
		homeUrl?: string;
		title?: string | null;
		logo?: string;
		showModeToggle?: boolean;
		navItems?: Snippet;
		rightContent?: Snippet;
		subnav?: Snippet;
		headerClass?: string;

		// Body layout
		// 'fixed'  — full viewport, header + body + footer; body owns its own scroll. For app-like pages (builder, preview, library/[guid]).
		// 'scroll' — sticky header, body fills `100vh - --header-h` and scrolls. For dashboard-style pages.
		mode?: 'fixed' | 'scroll';

		// Optional left rail. When present, body becomes flex row: sidenav | main.
		sidenav?: Snippet;

		// Footer (only rendered when `showFooter`)
		showFooter?: boolean;
		errors?: string[];
		warnings?: string[];
		footerChildren?: Snippet;

		// Body content
		class?: string;
		bodyClass?: string;
		children: Snippet;
	}

	let {
		showHeader = true,
		homeUrl = '/',
		title = undefined,
		logo = '/favicon/favicon.svg',
		showModeToggle = true,
		navItems,
		rightContent,
		subnav,
		headerClass = '',
		mode: _mode = 'scroll',
		sidenav,
		showFooter = false,
		errors = [],
		warnings = [],
		footerChildren,
		class: className = '',
		bodyClass = '',
		children
	}: AppShellProps = $props();

	// fixed: viewport-locked, no page scroll — body owns its own scroll internally.
	// scroll: normal page flow, footer sticks to bottom via sticky positioning.
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
		<PageHeader
			{homeUrl}
			{title}
			{logo}
			{showModeToggle}
			{navItems}
			{rightContent}
			{subnav}
			class={headerClass}
		/>
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
			<PageFooter {errors} {warnings}>
				{#if footerChildren}
					{@render footerChildren()}
				{/if}
			</PageFooter>
		</div>
	{/if}
</div>
