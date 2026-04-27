<script lang="ts">
	import type { Snippet } from 'svelte';
	import PageHeader from './PageHeader.svelte';
	import PageFooter from './PageFooter.svelte';

	interface AppShellProps {
		// Header
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
		homeUrl = '/',
		title = undefined,
		logo = '/favicon/favicon.svg',
		showModeToggle = true,
		navItems,
		rightContent,
		subnav,
		headerClass = '',
		mode = 'scroll',
		sidenav,
		showFooter = false,
		errors = [],
		warnings = [],
		footerChildren,
		class: className = '',
		bodyClass = '',
		children
	}: AppShellProps = $props();

	const rootClass = $derived(
		mode === 'fixed'
			? `flex flex-col h-screen overflow-hidden bg-background ${className}`
			: `flex flex-col bg-background ${className}`
	);

	const bodyShellClass = $derived(
		mode === 'fixed'
			? `flex flex-1 min-h-0 ${sidenav ? 'flex-row' : 'flex-col'} ${bodyClass}`
			: `flex h-[calc(100vh-var(--header-h))] overflow-hidden ${sidenav ? 'flex-row' : 'flex-col'} ${bodyClass}`.trim()
	);
</script>

<div class={rootClass}>
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

	<div class={bodyShellClass}>
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
		<div class="shrink-0">
			<PageFooter {errors} {warnings}>
				{#if footerChildren}
					{@render footerChildren()}
				{/if}
			</PageFooter>
		</div>
	{/if}
</div>
